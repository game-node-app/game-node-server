import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { GameRepositoryController } from "./game-repository.controller";
import { GameRepositoryService } from "./game-repository.service";
import { GameCoverService } from "../game-cover/game-cover.service";
import { AuthService } from "../../auth/auth.service";

describe("GameRepositoryController cover personalization", () => {
    let app: INestApplication;
    let gameRepositoryService: {
        findAllByIds: jest.Mock;
        findOneByIdOrFail: jest.Mock;
    };
    let gameCoverService: { applyEffectiveCovers: jest.Mock };
    let getSession: jest.Mock;

    const game = {
        id: 10,
        name: "Game",
        cover: { id: 1, imageId: "default" },
    };
    const personalized = {
        ...game,
        cover: { id: 2, imageId: "chosen" },
    };

    beforeEach(async () => {
        getSession = jest.fn(async () => ({
            user: { id: "viewer-1", role: "user" },
        }));
        gameRepositoryService = {
            findAllByIds: jest.fn(async () => [game]),
            findOneByIdOrFail: jest.fn(async () => game),
        };
        gameCoverService = {
            applyEffectiveCovers: jest.fn(async () => [personalized]),
        };

        const module = await Test.createTestingModule({
            controllers: [GameRepositoryController],
            providers: [
                {
                    provide: GameRepositoryService,
                    useValue: gameRepositoryService,
                },
                { provide: GameCoverService, useValue: gameCoverService },
                { provide: AuthService, useValue: { getSession } },
            ],
        }).compile();

        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    const server = () => app.getHttpServer();
    const findAll = (body: object) =>
        request(server()).post("/game/repository").send(body);
    const findOne = (id: number, body?: object) =>
        body
            ? request(server()).post(`/game/repository/${id}`).send(body)
            : request(server()).post(`/game/repository/${id}`);

    /** The @Cacheable key is JSON.stringify([dto]), so the args must match today's exactly. */
    function expectCachedArgs(actual: unknown[], expected: unknown[]) {
        expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    }

    it("reads without opt-in without a session or a choice lookup", async () => {
        const response = await findAll({
            gameIds: [10],
            relations: { cover: true },
        });

        expect(response.status).toBe(200);
        expect(getSession).not.toHaveBeenCalled();
        expect(gameCoverService.applyEffectiveCovers).not.toHaveBeenCalled();
        expectCachedArgs(gameRepositoryService.findAllByIds.mock.calls[0], [
            { gameIds: [10], relations: { cover: true } },
        ]);
        expect(response.body[0].cover.imageId).toBe("default");
    });

    it("does not personalize an opt-in read without the cover relation", async () => {
        const response = await findAll({
            gameIds: [10],
            relations: { platforms: true },
            personalizeCovers: true,
        });

        expect(response.status).toBe(200);
        expect(getSession).not.toHaveBeenCalled();
        expect(gameCoverService.applyEffectiveCovers).not.toHaveBeenCalled();
        expectCachedArgs(gameRepositoryService.findAllByIds.mock.calls[0], [
            { gameIds: [10], relations: { platforms: true } },
        ]);
    });

    it("personalizes a read that requests the cover relation", async () => {
        const response = await findAll({
            gameIds: [10],
            relations: { cover: true },
            personalizeCovers: true,
        });

        expect(response.status).toBe(200);
        expect(getSession).toHaveBeenCalledTimes(1);
        expect(gameCoverService.applyEffectiveCovers).toHaveBeenCalledWith(
            [game],
            "viewer-1",
            undefined,
        );
        expectCachedArgs(gameRepositoryService.findAllByIds.mock.calls[0], [
            { gameIds: [10], relations: { cover: true } },
        ]);
        expect(response.body[0].cover.imageId).toBe("chosen");
    });

    it("opts in through the cover owner alone", async () => {
        getSession.mockResolvedValueOnce(null);

        const response = await findAll({
            gameIds: [10],
            relations: { cover: true },
            coverOwnerUserId: "owner-1",
        });

        expect(response.status).toBe(200);
        expect(gameCoverService.applyEffectiveCovers).toHaveBeenCalledWith(
            [game],
            undefined,
            "owner-1",
        );
    });

    it("treats an invalid session as an anonymous viewer", async () => {
        getSession.mockRejectedValueOnce(new Error("invalid session"));

        const response = await findAll({
            gameIds: [10],
            relations: { cover: true },
            personalizeCovers: true,
        });

        expect(response.status).toBe(200);
        expect(gameCoverService.applyEffectiveCovers).toHaveBeenCalledWith(
            [game],
            undefined,
            undefined,
        );
    });

    it("accepts the usual boolean representations for the flag", async () => {
        await findAll({
            gameIds: [10],
            relations: { cover: true },
            personalizeCovers: "true",
        });

        expect(gameCoverService.applyEffectiveCovers).toHaveBeenCalledTimes(1);
    });

    it("keeps the single-read cache arguments unchanged", async () => {
        const response = await findOne(10, { relations: { cover: true } });

        expect(response.status).toBe(200);
        expect(getSession).not.toHaveBeenCalled();
        expectCachedArgs(
            gameRepositoryService.findOneByIdOrFail.mock.calls[0],
            [10, { relations: { cover: true } }],
        );
        expect(response.body.cover.imageId).toBe("default");
    });

    it("keeps the cached single-read key unchanged when there is no body", async () => {
        const response = await findOne(10);

        expect(response.status).toBe(200);
        expectCachedArgs(
            gameRepositoryService.findOneByIdOrFail.mock.calls[0],
            [10, {}],
        );
        expect(gameCoverService.applyEffectiveCovers).not.toHaveBeenCalled();
    });

    it("personalizes a single read that requests the cover relation", async () => {
        const response = await findOne(10, {
            relations: { cover: true },
            personalizeCovers: true,
        });

        expect(response.status).toBe(200);
        expect(getSession).toHaveBeenCalledTimes(1);
        expectCachedArgs(
            gameRepositoryService.findOneByIdOrFail.mock.calls[0],
            [10, { relations: { cover: true } }],
        );
        expect(response.body.cover.imageId).toBe("chosen");
    });

    it("does not personalize a single read without the cover relation", async () => {
        await findOne(10, {
            relations: { platforms: true },
            personalizeCovers: true,
        });

        expect(getSession).not.toHaveBeenCalled();
        expect(gameCoverService.applyEffectiveCovers).not.toHaveBeenCalled();
    });
});
