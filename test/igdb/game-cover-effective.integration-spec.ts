import {
    Global,
    INestApplication,
    Module,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken, TypeOrmModule } from "@nestjs/typeorm";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import { createCache } from "cache-manager";
import { createKeyv } from "@keyv/redis";
import request from "supertest";
import { DataSource, In, Repository } from "typeorm";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createNotificationTestDataSource } from "../notifications/notification-test-harness";
import { testEnvironment } from "./helpers/test-environment";
import { AuthService } from "../../src/auth/auth.service";
import { GameRepositoryController } from "../../src/game/game-repository/game-repository.controller";
import { GameRepositoryService } from "../../src/game/game-repository/game-repository.service";
import { GameCoverService } from "../../src/game/game-cover/game-cover.service";
import { GameCoverOption } from "../../src/game/game-cover/entities/game-cover-option.entity";
import { UserGameCover } from "../../src/game/game-cover/entities/user-game-cover.entity";
import {
    CustomCoverMode,
    GameCoverKind,
    GameCoverOrigin,
} from "../../src/game/game-cover/game-cover.constants";
import { Game } from "../../src/game/game-repository/entities/game.entity";
import { GameCover } from "../../src/game/game-repository/entities/game-cover.entity";
import { GamePlatform } from "../../src/game/game-repository/entities/game-platform.entity";
import { Profile } from "../../src/profile/entities/profile.entity";
import { ExternalGameService } from "../../src/game/external-game/external-game.service";
import { GameCoverModule } from "../../src/game/game-cover/game-cover.module";
import { setCacheManager } from "../../src/utils/cacheable";

/** Game repository routes rely on the global AuthModule in the app; the graph test stubs it. */
@Global()
@Module({
    providers: [{ provide: AuthService, useValue: {} }],
    exports: [AuthService],
})
class AuthStubModule {}

describe("effective cover resolution on MySQL", () => {
    let source: DataSource;
    let app: INestApplication;
    let gameCoverService: GameCoverService;
    let currentUser: string | null = null;
    let sessionFails = false;
    let cache: ReturnType<typeof createCache>;
    let nextId = 8_100_000_000 + Math.floor(Math.random() * 100_000_000);
    const gameIds: number[] = [];
    const userIds: string[] = [];

    const gameRepository = () => source.getRepository(Game);
    const optionRepository = () => source.getRepository(GameCoverOption);
    const choiceRepository = () => source.getRepository(UserGameCover);
    const profileRepository = () => source.getRepository(Profile);

    function id() {
        return nextId++;
    }

    async function createGame(values: Partial<Game> = {}) {
        const gameId = id();
        await gameRepository().insert({
            id: gameId,
            name: `Effective cover game ${gameId}`,
            slug: `effective-cover-game-${gameId}`,
            ...values,
        });
        gameIds.push(gameId);
        return gameId;
    }

    async function setDefaultCover(gameId: number, imageId: string) {
        await source.query(
            "INSERT INTO game_cover (id, gameId, imageId, url) VALUES (?, ?, ?, ?)",
            [
                id(),
                gameId,
                imageId,
                `https://images.test/t_thumb/${imageId}.jpg`,
            ],
        );
    }

    async function createOption(values: {
        gameId: number;
        kind: GameCoverKind;
        origin?: GameCoverOrigin;
        igdbId?: number;
        imageId?: string;
    }) {
        const igdbId = values.igdbId ?? id();
        const imageId = values.imageId ?? `image-${id()}`;
        const result = await optionRepository().insert({
            gameId: values.gameId,
            kind: values.kind,
            origin: values.origin ?? GameCoverOrigin.Cover,
            igdbId,
            imageId,
            url: `https://images.test/t_thumb/${imageId}.jpg`,
            width: 264,
            height: 352,
            alphaChannel: false,
            animated: false,
            checksum: `checksum-${imageId}`,
            label: null,
        });
        return {
            id: Number(result.identifiers[0].id),
            igdbId,
            imageId,
        };
    }

    async function createUser(mode?: CustomCoverMode) {
        const userId = randomUUID();
        await profileRepository().insert({
            userId,
            username: `eff_${userId.slice(0, 8)}`,
            ...(mode ? { customCoverMode: mode } : {}),
        });
        userIds.push(userId);
        return userId;
    }

    async function choose(
        userId: string,
        gameId: number,
        coverOptionId: number,
    ) {
        await choiceRepository().upsert({ userId, gameId, coverOptionId }, [
            "userId",
            "gameId",
        ]);
    }

    async function loadGames(ids: number[]) {
        return await gameRepository().find({
            where: { id: In(ids) },
            relations: { cover: true },
        });
    }

    function coverOf(game: Game | undefined) {
        return game?.cover as Record<string, unknown> | undefined;
    }

    const repositoryProviders = () => [
        { provide: getRepositoryToken(Game), useValue: gameRepository() },
        {
            provide: getRepositoryToken(GamePlatform),
            useValue: source.getRepository(GamePlatform),
        },
        {
            provide: getRepositoryToken(GameCoverOption),
            useValue: optionRepository(),
        },
        {
            provide: getRepositoryToken(UserGameCover),
            useValue: choiceRepository(),
        },
        { provide: getRepositoryToken(Profile), useValue: profileRepository() },
    ];

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        const settings = testEnvironment(process.env);
        cache = createCache({
            stores: [
                createKeyv(
                    `redis://${settings.redis.host}:${settings.redis.port}`,
                ),
            ],
        });
        setCacheManager(cache);

        const module = await Test.createTestingModule({
            controllers: [GameRepositoryController],
            providers: [
                GameRepositoryService,
                GameCoverService,
                {
                    provide: AuthService,
                    useValue: {
                        getSession: jest.fn(async () => {
                            if (sessionFails)
                                throw new Error("invalid session");
                            return currentUser
                                ? { user: { id: currentUser, role: "user" } }
                                : null;
                        }),
                    },
                },
                { provide: DataSource, useValue: source },
                {
                    provide: ExternalGameService,
                    useValue: {},
                },
                { provide: CACHE_MANAGER, useValue: cache },
                { provide: Cache, useValue: cache },
                ...repositoryProviders(),
            ],
        }).compile();

        app = module.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
        gameCoverService = module.get(GameCoverService);
    }, 120_000);

    beforeEach(() => {
        currentUser = null;
        sessionFails = false;
    });

    afterAll(async () => {
        await app?.close();
        await cache?.disconnect();
        if (!source?.isInitialized) return;
        if (gameIds.length) {
            await source
                .getRepository(GameCover)
                .createQueryBuilder()
                .delete()
                .where("gameId IN (:...gameIds)", { gameIds })
                .execute();
            await gameRepository().delete({ id: In(gameIds) });
        }
        if (userIds.length)
            await profileRepository().delete({ userId: In(userIds) });
        await source.destroy();
    }, 60_000);

    describe("GameCoverService.applyEffectiveCovers", () => {
        it("mode any: the owner's choice wins over the viewer's", async () => {
            const viewer = await createUser(CustomCoverMode.Any);
            const owner = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default");
            const viewerOption = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
                imageId: "viewer-choice",
            });
            const ownerOption = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "owner-choice",
            });
            await choose(viewer, game, viewerOption.id);
            await choose(owner, game, ownerOption.id);

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                viewer,
                owner,
            );

            expect(coverOf(resolved)).toMatchObject({
                id: ownerOption.igdbId,
                imageId: "owner-choice",
            });
        });

        it("mode any: uses the viewer's choice when there is no owner", async () => {
            const viewer = await createUser(CustomCoverMode.Any);
            const game = await createGame();
            await setDefaultCover(game, "default");
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Historical,
                imageId: "viewer-choice",
            });
            await choose(viewer, game, option.id);

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                viewer,
            );

            expect(coverOf(resolved)).toMatchObject({
                id: option.igdbId,
                imageId: "viewer-choice",
            });
        });

        it("prefer_yours: the viewer's choice wins over the owner's", async () => {
            const viewer = await createUser(CustomCoverMode.PreferYours);
            const owner = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default");
            const viewerOption = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
                imageId: "viewer-choice",
            });
            const ownerOption = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "owner-choice",
            });
            await choose(viewer, game, viewerOption.id);
            await choose(owner, game, ownerOption.id);

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                viewer,
                owner,
            );

            expect(coverOf(resolved)).toMatchObject({
                id: viewerOption.igdbId,
                imageId: "viewer-choice",
            });
        });

        it("prefer_yours: falls back to the owner's choice without one", async () => {
            const viewer = await createUser(CustomCoverMode.PreferYours);
            const owner = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default");
            const ownerOption = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "owner-choice",
            });
            await choose(owner, game, ownerOption.id);

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                viewer,
                owner,
            );

            expect(coverOf(resolved)).toMatchObject({
                id: ownerOption.igdbId,
                imageId: "owner-choice",
            });
        });

        it("mode none: returns defaults without reading choices", async () => {
            const viewer = await createUser(CustomCoverMode.None);
            const game = await createGame();
            await setDefaultCover(game, "default");
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "viewer-choice",
            });
            await choose(viewer, game, option.id);
            const injected = (
                gameCoverService as unknown as {
                    choiceRepository: Repository<UserGameCover>;
                }
            ).choiceRepository;
            const choiceFind = jest.spyOn(injected, "find");

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                viewer,
            );

            expect(choiceFind).not.toHaveBeenCalled();
            expect(coverOf(resolved)).toMatchObject({ imageId: "default" });
            choiceFind.mockRestore();
        });

        it("anonymous viewer: uses the owner's choice", async () => {
            const owner = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default");
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
                imageId: "owner-choice",
            });
            await choose(owner, game, option.id);

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                undefined,
                owner,
            );

            expect(coverOf(resolved)).toMatchObject({
                id: option.igdbId,
                imageId: "owner-choice",
            });
        });

        it("returns the default cover when neither side has a choice", async () => {
            const viewer = await createUser();
            const owner = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default");

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                viewer,
                owner,
            );

            expect(coverOf(resolved)).toMatchObject({
                imageId: "default",
                url: "https://images.test/t_thumb/default.jpg",
            });
        });

        it("accepts an unknown owner and lets it contribute no choice", async () => {
            const viewer = await createUser(CustomCoverMode.Any);
            const game = await createGame();
            await setDefaultCover(game, "default");
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "viewer-choice",
            });
            await choose(viewer, game, option.id);

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                viewer,
                randomUUID(),
            );

            expect(coverOf(resolved)).toMatchObject({ imageId: "default" });
        });

        it("adds a cover to a game that has no default cover", async () => {
            const viewer = await createUser();
            const game = await createGame();
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
                imageId: "chosen",
            });
            await choose(viewer, game, option.id);

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                await loadGames([game]),
                viewer,
            );

            expect(coverOf(resolved)).toMatchObject({
                id: option.igdbId,
                imageId: "chosen",
                url: "https://images.test/t_thumb/chosen.jpg",
                width: 264,
                height: 352,
                alphaChannel: false,
                animated: false,
                checksum: "checksum-chosen",
            });
        });

        it("returns copies without mutating the cached games", async () => {
            const viewer = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default");
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "chosen",
            });
            await choose(viewer, game, option.id);
            const games = await loadGames([game]);
            const originalCover = games[0].cover;

            const [resolved] = await gameCoverService.applyEffectiveCovers(
                games,
                viewer,
            );

            expect(resolved).not.toBe(games[0]);
            expect(resolved.cover).not.toBe(games[0].cover);
            expect(games[0].cover).toBe(originalCover);
            expect(originalCover).toMatchObject({ imageId: "default" });
        });
    });

    describe("personalized reads through the real cache", () => {
        const server = () => app.getHttpServer();
        const findAll = (body: object) =>
            request(server()).post("/v1/game/repository").send(body);
        const findOne = (gameId: number, body: object) =>
            request(server()).post(`/v1/game/repository/${gameId}`).send(body);

        async function waitForCachedValue(key: string) {
            for (let attempt = 0; attempt < 200; attempt++) {
                if (await cache.get(key)) return;
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error(`Cache key was not written: ${key}`);
        }

        it("does not alter the shared cache and applies a changed choice immediately", async () => {
            const viewer = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default-image");
            const first = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
                imageId: "choice-a",
            });
            const second = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "choice-b",
            });
            await choose(viewer, game, first.id);
            currentUser = viewer;

            const personalized = await findAll({
                gameIds: [game],
                relations: { cover: true },
                personalizeCovers: true,
            });
            expect(personalized.status).toBe(200);
            expect(personalized.body[0].cover.imageId).toBe("choice-a");

            const cacheKey = `GameRepositoryService#findAllByIds__${JSON.stringify(
                [{ gameIds: [game], relations: { cover: true } }],
            )}`;
            await waitForCachedValue(cacheKey);

            // A changed default in the database stays invisible while the shared cache lives.
            await source.query(
                "UPDATE game_cover SET imageId = 'db-changed' WHERE gameId = ?",
                [game],
            );

            const plain = await findAll({
                gameIds: [game],
                relations: { cover: true },
            });
            expect(plain.status).toBe(200);
            expect(plain.body[0].cover.imageId).toBe("default-image");

            // A choice change is read on every request, outside the shared cache.
            await choose(viewer, game, second.id);
            const changed = await findAll({
                gameIds: [game],
                relations: { cover: true },
                personalizeCovers: true,
            });
            expect(changed.status).toBe(200);
            expect(changed.body[0].cover.imageId).toBe("choice-b");

            // Same shape as a default cover.
            expect(Object.keys(changed.body[0].cover).sort()).toEqual(
                Object.keys(plain.body[0].cover).sort(),
            );
        });

        it("isolates a personalized single read from the cache", async () => {
            const viewer = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default-image");
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Historical,
                imageId: "chosen",
            });
            await choose(viewer, game, option.id);
            currentUser = viewer;

            const personalized = await findOne(game, {
                relations: { cover: true },
                personalizeCovers: true,
            });
            expect(personalized.status).toBe(200);
            expect(personalized.body.cover.imageId).toBe("chosen");
            expect(Object.keys(personalized.body.cover).sort()).toEqual(
                Object.keys(
                    (
                        await findOne(game, {
                            relations: { cover: true },
                        })
                    ).body.cover,
                ).sort(),
            );

            const plain = await findOne(game, {
                relations: { cover: true },
            });
            expect(plain.status).toBe(200);
            expect(plain.body.cover.imageId).toBe("default-image");
        });

        it("personalizes an anonymous read for a cover owner", async () => {
            const owner = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default-image");
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
                imageId: "owner-choice",
            });
            await choose(owner, game, option.id);

            const response = await findAll({
                gameIds: [game],
                relations: { cover: true },
                coverOwnerUserId: owner,
            });

            expect(response.status).toBe(200);
            expect(response.body[0].cover.imageId).toBe("owner-choice");
        });

        it("treats an invalid session as an anonymous viewer", async () => {
            const viewer = await createUser();
            const game = await createGame();
            await setDefaultCover(game, "default-image");
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "viewer-choice",
            });
            await choose(viewer, game, option.id);
            currentUser = viewer;
            sessionFails = true;

            const response = await findAll({
                gameIds: [game],
                relations: { cover: true },
                personalizeCovers: true,
            });

            expect(response.status).toBe(200);
            expect(response.body[0].cover.imageId).toBe("default-image");
        });
    });
});

describe("game cover module graph", () => {
    it("builds without the game repository module, so no provider cycle exists", async () => {
        const settings = testEnvironment(process.env);
        const module = await Test.createTestingModule({
            imports: [
                TypeOrmModule.forRoot({
                    ...settings.mysql,
                    entities: [resolve(__dirname, "../../src/**/*.entity.ts")],
                    synchronize: false,
                    timezone: "Z",
                    dateStrings: ["DATE"],
                }),
                AuthStubModule,
                GameCoverModule,
            ],
        }).compile();

        expect(module.get(GameCoverService)).toBeDefined();
        await module.close();
    }, 120_000);
});
