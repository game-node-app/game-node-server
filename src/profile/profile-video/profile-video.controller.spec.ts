import { PROFILE_VIDEO_TEST_TEMP_ROOT } from "../../../test/mocks/profile-video-temp-root";

jest.mock("./profile-video-media", () => {
    const actual = jest.requireActual("./profile-video-media");
    return { ...actual, probe: jest.fn() };
});

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { ThrottlerModule } from "@nestjs/throttler";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import { readdir, rm, stat } from "node:fs/promises";
import { AuthService } from "../../auth/auth.service";
import { BillingService } from "../../billing/billing.service";
import { UploadService } from "../../upload/upload.service";
import { ProfileVideo } from "../entities/profile-video.entity";
import { probe, ProfileVideoError } from "./profile-video-media";
import {
    PROFILE_VIDEO_MAX_UPLOAD_BYTES,
    PROFILE_VIDEO_QUEUE_NAME,
} from "./profile-video.constants";
import { ProfileVideoController } from "./profile-video.controller";
import { ProfileVideoQueueService } from "./profile-video-queue.service";
import { ProfileVideoService } from "./profile-video.service";
import { SupporterGuard } from "../../billing/supporter.guard";

const probeMock = probe as jest.Mock;

function repositoryMock() {
    const executed: { affected: number }[] = [];
    const queryBuilder: Record<string, jest.Mock> = {
        execute: jest.fn(async () => executed.shift() ?? { affected: 1 }),
    };
    for (const method of [
        "insert",
        "into",
        "values",
        "orIgnore",
        "update",
        "set",
        "where",
        "andWhere",
    ]) {
        queryBuilder[method] = jest.fn(() => queryBuilder);
    }
    return {
        executed,
        queryBuilder,
        repository: {
            createQueryBuilder: jest.fn(() => queryBuilder),
            find: jest.fn(async () => []),
            findOne: jest.fn(),
            manager: { transaction: jest.fn() },
        },
    };
}

async function tempEntries(): Promise<string[]> {
    return (await readdir(PROFILE_VIDEO_TEST_TEMP_ROOT).catch(() => [])).sort();
}

describe("ProfileVideoController", () => {
    let app: INestApplication;
    let billing: { isSupporter: jest.Mock };
    let auth: { getSession: jest.Mock };
    let queue: { add: jest.Mock };
    let repoFixture: ReturnType<typeof repositoryMock>;

    beforeEach(async () => {
        jest.clearAllMocks();
        probeMock.mockResolvedValue({});
        repoFixture = repositoryMock();
        billing = { isSupporter: jest.fn(async () => true) };
        auth = {
            getSession: jest.fn(async () => ({
                user: { id: "user-1", role: "user" },
            })),
        };
        queue = { add: jest.fn(async () => ({})) };

        const moduleRef = await Test.createTestingModule({
            imports: [ThrottlerModule.forRoot([{ limit: 5, ttl: 60_000 }])],
            controllers: [ProfileVideoController],
            providers: [
                ProfileVideoService,
                ProfileVideoQueueService,
                SupporterGuard,
                {
                    provide: getRepositoryToken(ProfileVideo),
                    useValue: repoFixture.repository,
                },
                {
                    provide: getQueueToken(PROFILE_VIDEO_QUEUE_NAME),
                    useValue: queue,
                },
                { provide: BillingService, useValue: billing },
                { provide: UploadService, useValue: {} },
                { provide: AuthService, useValue: auth },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
        await rm(PROFILE_VIDEO_TEST_TEMP_ROOT, {
            recursive: true,
            force: true,
        });
    });

    function upload(payload = Buffer.from("video-bytes")) {
        return request(app.getHttpServer())
            .put("/profile/video")
            .field("type", "avatar")
            .attach("file", payload, {
                filename: "clip.mp4",
                contentType: "video/mp4",
            });
    }

    function uploadWithFields(fields: Record<string, string>) {
        let pending = request(app.getHttpServer()).put("/profile/video");
        for (const [key, value] of Object.entries(fields)) {
            pending = pending.field(key, value);
        }
        return pending.attach("file", Buffer.from("video-bytes"), "clip.mp4");
    }

    it("accepts a supporter video with 202 and keeps the source for the worker", async () => {
        probeMock.mockImplementation(async (path: string) => {
            expect(((await stat(path)).mode & 0o777).toString(8)).toBe("644");
            return {};
        });

        const response = await upload();

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ status: "processing" });
        expect(probeMock).toHaveBeenCalledTimes(1);
        expect(queue.add).toHaveBeenCalledWith(
            "process-profile-video",
            expect.objectContaining({
                userId: "user-1",
                type: "avatar",
                sourcePath: expect.stringContaining(
                    PROFILE_VIDEO_TEST_TEMP_ROOT,
                ),
                attemptId: expect.any(String),
            }),
        );
        expect(repoFixture.queryBuilder.andWhere).toHaveBeenCalledWith(
            "(status IS NULL OR status <> 'processing' OR processingStartedAt < :stale)",
            { stale: expect.any(Date) },
        );
        await expect(
            readdir(PROFILE_VIDEO_TEST_TEMP_ROOT),
        ).resolves.toHaveLength(1);
    });

    it("accepts crop fields together and passes them to the queue", async () => {
        const response = await uploadWithFields({
            type: "banner",
            cropX: "0.1",
            cropY: "0.2",
            cropWidth: "0.5",
            cropHeight: "0.6",
        });

        expect(response.status).toBe(202);
        expect(queue.add).toHaveBeenCalledWith(
            "process-profile-video",
            expect.objectContaining({
                crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
            }),
        );
    });

    it("returns 400 when no file is sent", async () => {
        const before = await tempEntries();
        const response = await request(app.getHttpServer())
            .put("/profile/video")
            .field("type", "avatar");

        expect(response.status).toBe(400);
        expect(await tempEntries()).toEqual(before);
    });

    it.each([
        ["an invalid slot", { type: "cover" }],
        ["a partial crop", { type: "avatar", cropX: "0.1" }],
        [
            "an out-of-bounds crop",
            {
                type: "avatar",
                cropX: "0.6",
                cropY: "0",
                cropWidth: "0.5",
                cropHeight: "1",
            },
        ],
        [
            "a non-numeric crop",
            {
                type: "avatar",
                cropX: "a",
                cropY: "0",
                cropWidth: "0.5",
                cropHeight: "0.5",
            },
        ],
    ])("returns 400 for %s and removes the file", async (_name, fields) => {
        const response = await uploadWithFields(fields);

        expect(response.status).toBe(400);
        await expect(tempEntries()).resolves.toEqual([]);
        expect(probeMock).not.toHaveBeenCalled();
    });

    it("returns 400 and removes the file when the source is rejected", async () => {
        probeMock.mockRejectedValue(new ProfileVideoError("rejected_source"));

        const response = await upload();

        expect(response.status).toBe(400);
        await expect(tempEntries()).resolves.toEqual([]);
    });

    it("returns 401 and writes no file when unauthenticated", async () => {
        auth.getSession.mockResolvedValue(null);
        const before = await tempEntries();

        const response = await upload();

        expect(response.status).toBe(401);
        expect(await tempEntries()).toEqual(before);
        expect(probeMock).not.toHaveBeenCalled();
    });

    it("returns 403 and writes no file for a non-supporter", async () => {
        billing.isSupporter.mockResolvedValue(false);
        const before = await tempEntries();

        const response = await upload();

        expect(response.status).toBe(403);
        expect(await tempEntries()).toEqual(before);
        expect(probeMock).not.toHaveBeenCalled();
    });

    it("returns 409 and removes the file when the slot is already processing", async () => {
        repoFixture.executed.push({ affected: 1 }, { affected: 0 });

        const response = await upload();

        expect(response.status).toBe(409);
        await expect(tempEntries()).resolves.toEqual([]);
        expect(queue.add).not.toHaveBeenCalled();
    });

    it("accepts the other slot while one is processing and scopes the claim by type", async () => {
        repoFixture.executed.push({ affected: 1 }, { affected: 0 });

        const blocked = await upload();

        expect(blocked.status).toBe(409);

        const accepted = await request(app.getHttpServer())
            .put("/profile/video")
            .field("type", "banner")
            .attach("file", Buffer.from("video-bytes"), {
                filename: "clip.mp4",
                contentType: "video/mp4",
            });

        expect(accepted.status).toBe(202);
        expect(queue.add).toHaveBeenCalledWith(
            "process-profile-video",
            expect.objectContaining({ type: "banner" }),
        );
        expect(repoFixture.queryBuilder.where).toHaveBeenCalledWith(
            "profileUserId = :userId AND type = :type",
            { userId: "user-1", type: "banner" },
        );
    });

    it("never uses the uploaded file name in a path, command or queue payload", async () => {
        const response = await request(app.getHttpServer())
            .put("/profile/video")
            .field("type", "avatar")
            .attach("file", Buffer.from("video-bytes"), {
                filename: "../../evil $(touch pwned);.mp4",
                contentType: "video/mp4",
            });

        expect(response.status).toBe(202);
        const queued = queue.add.mock.calls[0][1];
        expect(queued.sourcePath).toContain(PROFILE_VIDEO_TEST_TEMP_ROOT);
        expect(queued.sourcePath).not.toMatch(/evil|pwned|\.\./);
        expect(probeMock.mock.calls[0][0]).toBe(queued.sourcePath);
        await expect(tempEntries()).resolves.toHaveLength(1);
    });

    it("returns 500, fails the attempt and removes the file when enqueueing fails", async () => {
        queue.add.mockRejectedValue(new Error("redis down"));

        const response = await upload();

        expect(response.status).toBe(500);
        expect(response.body.message).toBe("Could not queue video processing.");
        await expect(tempEntries()).resolves.toEqual([]);
        expect(repoFixture.queryBuilder.set).toHaveBeenCalledWith({
            status: "failed",
            errorCode: "conversion_failed",
        });
        expect(repoFixture.queryBuilder.where).toHaveBeenCalledWith(
            expect.stringContaining("attemptId = :attemptId"),
            expect.objectContaining({ attemptId: expect.any(String) }),
        );
    });

    it("returns 413 above the upload limit and writes no file", async () => {
        const before = await tempEntries();
        const response = await upload(
            Buffer.alloc(PROFILE_VIDEO_MAX_UPLOAD_BYTES + 1),
        );

        expect(response.status).toBe(413);
        expect(await tempEntries()).toEqual(before);
    }, 30_000);

    it("returns 429 without writing a file once the client exceeds the limit", async () => {
        billing.isSupporter.mockResolvedValue(false);
        const before = await tempEntries();

        for (let attempt = 0; attempt < 5; attempt++) {
            const response = await upload();
            expect(response.status).toBe(403);
        }
        const response = await upload();

        expect(response.status).toBe(429);
        expect(await tempEntries()).toEqual(before);
    });
});
