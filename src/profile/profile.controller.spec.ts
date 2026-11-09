import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import sharp from "sharp";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";
import { ProfileVideoService } from "./profile-video/profile-video.service";
import { AuthService } from "../auth/auth.service";

const GIF = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
);
const SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
);

function encoded(format: "png" | "jpeg" | "webp"): Promise<Buffer> {
    const image = sharp({
        create: {
            width: 2,
            height: 2,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
        },
    });
    if (format === "png") return image.png().toBuffer();
    if (format === "jpeg") return image.jpeg().toBuffer();
    return image.webp().toBuffer();
}

describe("ProfileController", () => {
    let app: INestApplication;
    let controller: ProfileController;
    let profileService: {
        findOneByIdOrFail: jest.Mock;
        updateProfileImage: jest.Mock;
    };
    let profileVideoService: { findForProfileRead: jest.Mock };

    beforeEach(async () => {
        profileService = {
            findOneByIdOrFail: jest.fn(),
            updateProfileImage: jest.fn(async () => undefined),
        };
        profileVideoService = { findForProfileRead: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ProfileController],
            providers: [
                {
                    provide: AuthService,
                    useValue: {
                        getSession: jest.fn(async () => ({
                            user: { id: "user-1", role: "user" },
                        })),
                    },
                },
                { provide: ProfileService, useValue: profileService },
                {
                    provide: ProfileVideoService,
                    useValue: profileVideoService,
                },
            ],
        }).compile();

        app = module.createNestApplication();
        await app.init();
        controller = module.get<ProfileController>(ProfileController);
    });

    afterEach(async () => {
        await app.close();
    });

    function upload(buffer: Buffer, contentType: string, filename: string) {
        return request(app.getHttpServer())
            .put("/profile/image")
            .field("type", "avatar")
            .attach("file", buffer, { filename, contentType });
    }

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    it("returns owner upload statuses from GET /profile", async () => {
        profileService.findOneByIdOrFail.mockResolvedValue({
            userId: "user-1",
            username: "me",
        });
        profileVideoService.findForProfileRead.mockResolvedValue({
            avatarVideo: {
                filename: "ab12",
                extension: "mp4",
                mimetype: "video/mp4",
                size: 812345,
                durationMs: 8000,
                width: 256,
                height: 256,
            },
            bannerVideo: null,
            videoUploads: {
                avatar: { status: "ready", errorCode: null },
                banner: null,
            },
        });

        const response = await request(app.getHttpServer()).get("/profile");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            userId: "user-1",
            username: "me",
            avatarVideo: { filename: "ab12", extension: "mp4" },
            bannerVideo: null,
            videoUploads: {
                avatar: { status: "ready", errorCode: null },
                banner: null,
            },
        });
        expect(profileVideoService.findForProfileRead).toHaveBeenCalledWith(
            "user-1",
            true,
        );
    });

    it("omits upload statuses from GET /profile/:id", async () => {
        profileService.findOneByIdOrFail.mockResolvedValue({
            userId: "user-2",
            username: "them",
        });
        profileVideoService.findForProfileRead.mockResolvedValue({
            avatarVideo: null,
            bannerVideo: null,
        });

        const response = await request(app.getHttpServer()).get(
            "/profile/user-2",
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            userId: "user-2",
            username: "them",
            avatarVideo: null,
            bannerVideo: null,
        });
        expect(response.body).not.toHaveProperty("videoUploads");
        expect(profileVideoService.findForProfileRead).toHaveBeenCalledWith(
            "user-2",
            false,
        );
    });

    it.each([
        ["png", "image/png", "avatar.png"],
        ["jpeg", "image/jpeg", "avatar.jpg"],
    ])("accepts %s content", async (format, contentType, filename) => {
        const response = await upload(
            await encoded(format as "png" | "jpeg"),
            contentType,
            filename,
        );

        expect(response.status).toBe(200);
        expect(profileService.updateProfileImage).toHaveBeenCalledTimes(1);
    });

    it("rejects real GIF content", async () => {
        const response = await upload(GIF, "image/gif", "avatar.gif");

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("rejects a GIF renamed and declared as PNG", async () => {
        const response = await upload(GIF, "image/png", "avatar.png");

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("rejects WebP content", async () => {
        const response = await upload(
            await encoded("webp"),
            "image/webp",
            "avatar.webp",
        );

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("rejects SVG content", async () => {
        const response = await upload(SVG, "image/svg+xml", "avatar.svg");

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("rejects undecodable content with 400", async () => {
        const response = await upload(
            Buffer.from("not an image"),
            "image/png",
            "avatar.png",
        );

        expect(response.status).toBe(400);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it("returns 413 above the upload limit", async () => {
        const response = await upload(
            Buffer.alloc(10_240_001),
            "image/png",
            "avatar.png",
        );

        expect(response.status).toBe(413);
        expect(profileService.updateProfileImage).not.toHaveBeenCalled();
    }, 30_000);
});
