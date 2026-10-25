import dayjs from "dayjs";
import { Test } from "@nestjs/testing";
import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import request from "supertest";
import { AuthGuard } from "../../auth/auth.guard";
import { GameAchievementController } from "./game-achievement.controller";
import { GameAchievementV2Controller } from "./game-achievement-v2.controller";
import { GameAchievementService } from "./game-achievement.service";
import { GameAchievementStatusService } from "./game-achievement-status.service";
import { GameAchievementActivityService } from "./game-achievement-activity.service";
import { GameObtainedAchievementService } from "./game-obtained-achievement.service";
import { GameAchievementSyncQueueService } from "./sync/game-achievement-sync-queue.service";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { JournalPlayLogService } from "../../journal/journal-play-log.service";

const date = new Date("2026-10-25T00:00:00Z");
const externalGame = {
    id: 10,
    gameId: 7,
    category: EGameExternalGameCategory.Steam,
};
const row = { externalAchievementId: "award", obtainedAt: date };

describe("persisted obtained reads", () => {
    let app: INestApplication;
    let viewer: string | undefined = "owner";
    let admitted = false;
    const queue = { add: jest.fn() };
    const state = {
        findConnection: jest.fn(async () => ({
            id: 1,
            sourceUserId: "account",
        })),
        claim: jest.fn(async () => {
            if (admitted) return null;
            admitted = true;
            return { externalGameId: 10 };
        }),
        enqueue: jest.fn(async (_owner, queue, name, data) =>
            queue.add(name, data),
        ),
    };
    const provider = {
        getObtainedAchievements: jest.fn(() => {
            throw new Error("read reached provider");
        }),
    };
    const repository = {
        findBy: jest.fn().mockResolvedValue([row]),
        save: jest.fn(),
    };
    const external = {
        findOneByIdOrFail: jest.fn().mockResolvedValue(externalGame),
        findAllForGameId: jest.fn().mockResolvedValue([externalGame]),
    };
    const obtained = new GameObtainedAchievementService(
        repository as any,
        external as any,
        provider as any,
        provider as any,
        provider as any,
        {} as any,
        new GameAchievementSyncQueueService(queue as any, state as any),
    );
    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [
                GameAchievementController,
                GameAchievementV2Controller,
            ],
            providers: [
                { provide: GameObtainedAchievementService, useValue: obtained },
                ...[
                    GameAchievementService,
                    GameAchievementStatusService,
                    GameAchievementActivityService,
                ].map((provide) => ({ provide, useValue: {} })),
            ],
        })
            .overrideGuard(AuthGuard)
            .useValue({
                canActivate(context: any) {
                    context.switchToHttp().getRequest().session = viewer
                        ? { getUserId: () => viewer }
                        : undefined;
                    return true;
                },
            })
            .compile();
        app = module.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });
    beforeEach(() => {
        viewer = "owner";
        admitted = false;
        queue.add.mockClear();
        state.claim.mockClear();
        provider.getObtainedAchievements.mockClear();
    });
    afterAll(async () => app.close());
    const payload = [
        {
            externalGameId: 10,
            externalId: "award",
            obtainedAt: date.toISOString(),
            isObtained: true,
            source: EGameExternalGameCategory.Steam,
            gameId: 7,
        },
    ];
    it("v1/v2 overlapping owner reads return persisted fields and admit one refresh", async () => {
        const responses = await Promise.all([
            request(app.getHttpServer()).get(
                "/v1/game/achievement/10/obtained",
            ),
            request(app.getHttpServer()).get("/v2/game/achievement/7/obtained"),
            request(app.getHttpServer()).get(
                "/v2/game/achievement/owner/7/obtained",
            ),
        ]);
        for (const response of responses) {
            expect(response.status).toBe(200);
            expect(response.body).toEqual(payload);
        }
        expect(queue.add).toHaveBeenCalledTimes(1);
        expect(provider.getObtainedAchievements).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
    });
    it("anonymous and other-user reads retain visibility without refresh authority", async () => {
        viewer = undefined;
        await request(app.getHttpServer())
            .get("/v1/game/achievement/10/obtained")
            .expect(200, []);
        await request(app.getHttpServer())
            .get("/v2/game/achievement/owner/7/obtained")
            .expect(200, payload);
        viewer = "other";
        await request(app.getHttpServer())
            .get("/v2/game/achievement/owner/7/obtained")
            .expect(200, payload);
        expect(state.claim).not.toHaveBeenCalled();
        expect(queue.add).not.toHaveBeenCalled();
    });
    it("keeps stale rows readable when queue admission fails", async () => {
        state.claim.mockRejectedValueOnce(new Error("Redis unavailable"));
        await request(app.getHttpServer())
            .get("/v1/game/achievement/10/obtained")
            .expect(200, payload);
        expect(repository.save).not.toHaveBeenCalled();
    });
    it("journal playlog uses the same persisted obtained rows and preserves its payload", async () => {
        const catalogue = {
            ...payload[0],
            obtainedAt: date,
            name: "Award",
            platformIds: [6],
        };
        const journal = new JournalPlayLogService(
            {
                findOneByUserIdAndGameIdOrFail: jest
                    .fn()
                    .mockResolvedValue({ ownedPlatforms: [] }),
            } as any,
            {
                findAllByGameId: jest
                    .fn()
                    .mockResolvedValue([{ achievements: [catalogue] }]),
            } as any,
            obtained,
            {} as any,
        );
        const result = await journal.getPlaylog("owner", 7, "owner");
        expect(result).toEqual([
            expect.objectContaining({
                date: dayjs(date).format("YYYY-MM-DD"),
                platformIds: [6],
                entries: [
                    expect.objectContaining({
                        obtainedAchievement: expect.objectContaining({
                            externalId: "award",
                            obtainedAt: date,
                            isObtained: true,
                        }),
                    }),
                ],
            }),
        ]);
        expect(queue.add).toHaveBeenCalledTimes(1);
        expect(provider.getObtainedAchievements).not.toHaveBeenCalled();
    });
});
