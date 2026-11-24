import {
    INestApplication,
    HttpException,
    ValidationPipe,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { CollectionsEntriesController } from "./collections-entries.controller";
import { CollectionsEntriesService } from "./collections-entries.service";
import { AuthService } from "../../auth/auth.service";

describe("CollectionsEntriesController", () => {
    let app: INestApplication;
    let service: {
        changeVisibility: jest.Mock;
        findOwnByGameIds: jest.Mock;
        findOneByIdForViewer: jest.Mock;
        findOneByUserIdAndGameIdForViewer: jest.Mock;
        findRelatedEntriesForViewer: jest.Mock;
        findIconsForOwnedPlatformsForViewer: jest.Mock;
    };
    let getSession: jest.Mock;

    beforeEach(async () => {
        service = {
            changeVisibility: jest.fn(),
            findOwnByGameIds: jest.fn().mockResolvedValue([]),
            findOneByIdForViewer: jest.fn().mockResolvedValue({ id: "entry" }),
            findOneByUserIdAndGameIdForViewer: jest
                .fn()
                .mockResolvedValue({ id: "entry" }),
            findRelatedEntriesForViewer: jest.fn(),
            findIconsForOwnedPlatformsForViewer: jest.fn(),
        };
        getSession = jest.fn(async () => ({
            user: { id: "user", role: "user" },
        }));
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CollectionsEntriesController],
            providers: [
                { provide: AuthService, useValue: { getSession } },
                {
                    provide: CollectionsEntriesService,
                    useValue: service,
                },
            ],
        }).compile();

        app = module.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it("changes the game's visibility for the session user with 204", async () => {
        const response = await request(app.getHttpServer())
            .post("/collections-entries/game/7/visibility")
            .send({ visibility: "private" });

        expect(response.status).toBe(204);
        expect(service.changeVisibility).toHaveBeenCalledWith(
            "user",
            7,
            "private",
        );
    });

    it("rejects an unknown visibility level with 400 without writing", async () => {
        const response = await request(app.getHttpServer())
            .post("/collections-entries/game/7/visibility")
            .send({ visibility: "friends" });

        expect(response.status).toBe(400);
        expect(service.changeVisibility).not.toHaveBeenCalled();
    });

    it("rejects a missing visibility level with 400", async () => {
        const response = await request(app.getHttpServer())
            .post("/collections-entries/game/7/visibility")
            .send({});

        expect(response.status).toBe(400);
        expect(service.changeVisibility).not.toHaveBeenCalled();
    });

    it("rejects a signed-out visibility change with 401", async () => {
        getSession.mockResolvedValue(null);

        const response = await request(app.getHttpServer())
            .post("/collections-entries/game/7/visibility")
            .send({ visibility: "private" });

        expect(response.status).toBe(401);
        expect(service.changeVisibility).not.toHaveBeenCalled();
    });

    it("returns 404 when the game is not in the library", async () => {
        service.changeVisibility.mockRejectedValue(
            new HttpException("Collection entry not found.", 404),
        );

        const response = await request(app.getHttpServer())
            .post("/collections-entries/game/7/visibility")
            .send({ visibility: "private" });

        expect(response.status).toBe(404);
    });

    it("passes the optional session to single-entry reads", async () => {
        await request(app.getHttpServer())
            .get("/collections-entries/entry")
            .expect(200);
        expect(service.findOneByIdForViewer).toHaveBeenCalledWith(
            "user",
            "entry",
        );

        getSession.mockResolvedValue(null);
        await request(app.getHttpServer())
            .get("/collections-entries/library/owner/game/7")
            .expect(200);
        expect(service.findOneByUserIdAndGameIdForViewer).toHaveBeenCalledWith(
            undefined,
            "owner",
            7,
        );
    });

    describe("POST /collections-entries/own", () => {
        it("returns the caller's matching entries in one batch", async () => {
            const owned = [{ id: "entry-7", gameId: 7 }];
            service.findOwnByGameIds.mockResolvedValue(owned);
            const gameIds = Array.from({ length: 90 }, (_, index) => index + 1);

            const response = await request(app.getHttpServer())
                .post("/collections-entries/own")
                .send({ gameIds })
                .expect(200);

            expect(response.body).toEqual(owned);
            expect(service.findOwnByGameIds).toHaveBeenCalledWith(
                "user",
                gameIds,
            );
        });

        it("returns an empty list when none of the games are owned", async () => {
            const response = await request(app.getHttpServer())
                .post("/collections-entries/own")
                .send({ gameIds: [7, 8] })
                .expect(200);

            expect(response.body).toEqual([]);
        });

        it("rejects a signed-out batch lookup with 401", async () => {
            getSession.mockResolvedValue(null);

            await request(app.getHttpServer())
                .post("/collections-entries/own")
                .send({ gameIds: [7] })
                .expect(401);

            expect(service.findOwnByGameIds).not.toHaveBeenCalled();
        });

        it.each([
            ["an empty array", []],
            [
                "more than 200 ids",
                Array.from({ length: 201 }, (_, index) => index + 1),
            ],
            ["a non-integer id", [7, 8.5]],
            ["a non-numeric id", [7, "8"]],
            ["a zero id", [7, 0]],
            ["a negative id", [7, -1]],
        ])("rejects %s with 400", async (_case, gameIds) => {
            await request(app.getHttpServer())
                .post("/collections-entries/own")
                .send({ gameIds })
                .expect(400);

            expect(service.findOwnByGameIds).not.toHaveBeenCalled();
        });
    });
});
