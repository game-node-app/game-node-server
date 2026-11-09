import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import { DataSource, In } from "typeorm";
import { randomUUID } from "node:crypto";
import { createNotificationTestDataSource } from "../notifications/notification-test-harness";
import { AuthService } from "../../src/auth/auth.service";
import { GameCoverController } from "../../src/game/game-cover/game-cover.controller";
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
import { Profile } from "../../src/profile/entities/profile.entity";
import { ProfileVideo } from "../../src/profile/entities/profile-video.entity";
import { ProfileService } from "../../src/profile/profile.service";
import { Library } from "../../src/libraries/entities/library.entity";
import { CollectionEntry } from "../../src/collections/collections-entries/entities/collection-entry.entity";
import { setCacheManager } from "../../src/utils/cacheable";

describe("game cover options and choices on MySQL", () => {
    let source: DataSource;
    let app: INestApplication;
    let currentUser: string | null = null;
    let nextId = 8_000_000_000 + Math.floor(Math.random() * 100_000_000);
    const gameIds: number[] = [];
    const userIds: string[] = [];

    const gameRepository = () => source.getRepository(Game);
    const optionRepository = () => source.getRepository(GameCoverOption);
    const choiceRepository = () => source.getRepository(UserGameCover);

    function id() {
        return nextId++;
    }

    async function createGame(values: Partial<Game> = {}) {
        const gameId = id();
        await gameRepository().insert({
            id: gameId,
            name: `Cover game ${gameId}`,
            slug: `cover-game-${gameId}`,
            ...values,
        });
        gameIds.push(gameId);
        return gameId;
    }

    async function setDefaultCover(gameId: number, imageId: string) {
        await source.query(
            "INSERT INTO game_cover (id, gameId, imageId, url) VALUES (?, ?, ?, ?)",
            [id(), gameId, imageId, `https://images.test/${imageId}.jpg`],
        );
    }

    async function createOption(values: {
        gameId: number;
        kind: GameCoverKind;
        origin?: GameCoverOrigin;
        igdbId?: number;
        imageId?: string;
        label?: string;
    }) {
        const igdbId = values.igdbId ?? id();
        const imageId = values.imageId ?? `image-${id()}`;
        const result = await optionRepository().insert({
            gameId: values.gameId,
            kind: values.kind,
            origin: values.origin ?? GameCoverOrigin.Cover,
            igdbId,
            imageId,
            url: `https://images.test/${imageId}.jpg`,
            label: values.label ?? null,
        });
        return {
            id: Number(result.identifiers[0].id),
            igdbId,
            imageId,
        };
    }

    async function createUser() {
        const userId = randomUUID();
        await source.getRepository(Profile).insert({
            userId,
            username: `cover_${userId.slice(0, 8)}`,
        });
        userIds.push(userId);
        return userId;
    }

    const optionsUrl = (gameId: number) => `/v1/game/cover/${gameId}/options`;
    const mineUrl = (gameId: number) => `/v1/game/cover/${gameId}/mine`;
    const server = () => app.getHttpServer();

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        setCacheManager({
            get: async () => undefined,
            set: async () => undefined,
        } as never);

        const module = await Test.createTestingModule({
            controllers: [GameCoverController],
            providers: [
                GameCoverService,
                {
                    provide: AuthService,
                    useValue: {
                        getSession: jest.fn(async () =>
                            currentUser
                                ? { user: { id: currentUser, role: "user" } }
                                : null,
                        ),
                    },
                },
                {
                    provide: getRepositoryToken(Game),
                    useValue: gameRepository(),
                },
                {
                    provide: getRepositoryToken(GameCoverOption),
                    useValue: optionRepository(),
                },
                {
                    provide: getRepositoryToken(UserGameCover),
                    useValue: choiceRepository(),
                },
                {
                    provide: getRepositoryToken(Profile),
                    useValue: source.getRepository(Profile),
                },
            ],
        }).compile();

        app = module.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    }, 120_000);

    beforeEach(() => {
        currentUser = null;
    });

    afterAll(async () => {
        await app?.close();
        if (!source?.isInitialized) return;
        if (userIds.length) {
            await source
                .getRepository(CollectionEntry)
                .delete({ libraryUserId: In(userIds) });
            await source.getRepository(Library).delete({ userId: In(userIds) });
        }
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
            await source.getRepository(Profile).delete({ userId: In(userIds) });
        await source.destroy();
    });

    describe("GET /v1/game/cover/:gameId/options", () => {
        it("returns localized, alternative and edition options of a base game", async () => {
            const base = await createGame();
            await setDefaultCover(base, "base-default");
            await createOption({
                gameId: base,
                kind: GameCoverKind.Edition,
                origin: GameCoverOrigin.Game,
                igdbId: base,
                imageId: "base-own",
                label: "Base game",
            });
            const localized = await createOption({
                gameId: base,
                kind: GameCoverKind.Localized,
                imageId: "japanese",
                label: "Japan",
            });
            const alternative = await createOption({
                gameId: base,
                kind: GameCoverKind.Alternative,
                imageId: "alternative",
            });
            const edition = await createGame({
                versionParentId: base,
                versionTitle: "Deluxe Edition",
            });
            const editionOption = await createOption({
                gameId: base,
                kind: GameCoverKind.Edition,
                origin: GameCoverOrigin.Game,
                igdbId: edition,
                imageId: "deluxe",
                label: "Deluxe Edition",
            });
            await createOption({
                gameId: base,
                kind: GameCoverKind.Alternative,
                imageId: "base-default",
            });

            const response = await request(server()).get(optionsUrl(base));

            expect(response.status).toBe(200);
            expect(response.body.map((item: any) => item.id).sort()).toEqual(
                [localized.id, alternative.id, editionOption.id].sort(),
            );
            const byId = new Map(
                response.body.map((item: any) => [item.id, item]),
            );
            expect(byId.get(localized.id)).toMatchObject({
                kind: "localized",
                label: "Japan",
                image: {
                    id: localized.igdbId,
                    imageId: "japanese",
                    url: "https://images.test/japanese.jpg",
                },
            });
            expect(byId.get(alternative.id)).toMatchObject({
                kind: "alternative",
                label: null,
            });
            expect(byId.get(editionOption.id)).toMatchObject({
                kind: "edition",
                label: "Deluxe Edition",
            });
        });

        it("returns the base game, its own cover and sibling editions for an edition page", async () => {
            const base = await createGame();
            await setDefaultCover(base, "base-default");
            const baseOwnOption = await createOption({
                gameId: base,
                kind: GameCoverKind.Edition,
                origin: GameCoverOrigin.Game,
                igdbId: base,
                imageId: "base-own",
                label: "Base game",
            });
            const edition = await createGame({
                versionParentId: base,
                versionTitle: "Edition",
            });
            await setDefaultCover(edition, "edition-default");
            const sibling = await createGame({
                versionParentId: base,
                versionTitle: "Sibling",
            });
            await createOption({
                gameId: base,
                kind: GameCoverKind.Edition,
                origin: GameCoverOrigin.Game,
                igdbId: edition,
                imageId: "edition-own",
                label: "Edition",
            });
            const siblingOption = await createOption({
                gameId: base,
                kind: GameCoverKind.Edition,
                origin: GameCoverOrigin.Game,
                igdbId: sibling,
                imageId: "sibling",
                label: "Sibling",
            });
            const baseLocalized = await createOption({
                gameId: base,
                kind: GameCoverKind.Localized,
                imageId: "base-japanese",
                label: "Japan",
            });
            const editionLocalized = await createOption({
                gameId: edition,
                kind: GameCoverKind.Localized,
                imageId: "edition-korean",
                label: "Korea",
            });
            await createOption({
                gameId: base,
                kind: GameCoverKind.Alternative,
                imageId: "edition-default",
            });

            const response = await request(server()).get(optionsUrl(edition));

            expect(response.status).toBe(200);
            expect(response.body.map((item: any) => item.id).sort()).toEqual(
                [
                    baseOwnOption.id,
                    siblingOption.id,
                    baseLocalized.id,
                    editionLocalized.id,
                ].sort(),
            );
        });

        it("returns an empty list when the game has no alternatives", async () => {
            const game = await createGame();
            await setDefaultCover(game, "only-cover");

            const response = await request(server()).get(optionsUrl(game));

            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
        });

        it("excludes options that repeat the game's default cover image", async () => {
            const game = await createGame();
            await setDefaultCover(game, "shared-image");
            await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
                imageId: "shared-image",
            });
            const kept = await createOption({
                gameId: game,
                kind: GameCoverKind.Historical,
                imageId: "other-image",
            });

            const response = await request(server()).get(optionsUrl(game));

            expect(response.status).toBe(200);
            expect(response.body.map((item: any) => item.id)).toEqual([
                kept.id,
            ]);
            expect(response.body[0]).toMatchObject({
                kind: "historical",
                image: { imageId: "other-image" },
            });
        });

        it("returns 404 for an unknown game", async () => {
            const response = await request(server()).get(
                optionsUrl(9_999_999_999),
            );

            expect(response.status).toBe(404);
        });
    });

    describe("/v1/game/cover/:gameId/mine", () => {
        it("stores and replaces the signed-in user's choice", async () => {
            const user = await createUser();
            const game = await createGame();
            const first = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
                label: "Japan",
            });
            const second = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
            });
            currentUser = user;

            const stored = await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: first.id });
            expect(stored.status).toBe(200);
            expect(stored.body).toEqual({ coverOptionId: first.id });
            expect(await choiceRepository().countBy({ userId: user })).toBe(1);

            const replaced = await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: second.id });
            expect(replaced.status).toBe(200);

            const read = await request(server()).get(mineUrl(game));
            expect(read.status).toBe(200);
            expect(read.body).toEqual({ coverOptionId: second.id });
            expect(await choiceRepository().countBy({ userId: user })).toBe(1);
        });

        it("returns an empty choice without an error", async () => {
            const user = await createUser();
            const game = await createGame();
            currentUser = user;

            const response = await request(server()).get(mineUrl(game));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ coverOptionId: null });
        });

        it("rejects an option outside the game's listing with 400", async () => {
            const user = await createUser();
            const game = await createGame();
            const eligible = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
            });
            const otherGame = await createGame();
            const ineligible = await createOption({
                gameId: otherGame,
                kind: GameCoverKind.Alternative,
            });
            currentUser = user;

            const rejected = await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: ineligible.id });
            expect(rejected.status).toBe(400);
            expect(await choiceRepository().countBy({ userId: user })).toBe(0);

            await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: eligible.id });
            const stillRejected = await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: ineligible.id });
            expect(stillRejected.status).toBe(400);
            const read = await request(server()).get(mineUrl(game));
            expect(read.body).toEqual({ coverOptionId: eligible.id });
        });

        it("rejects a body without a cover option id with 400", async () => {
            const user = await createUser();
            const game = await createGame();
            currentUser = user;

            const response = await request(server())
                .put(mineUrl(game))
                .send({});

            expect(response.status).toBe(400);
        });

        it("requires a session", async () => {
            const game = await createGame();

            expect((await request(server()).get(mineUrl(game))).status).toBe(
                401,
            );
            expect(
                (
                    await request(server())
                        .put(mineUrl(game))
                        .send({ coverOptionId: 1 })
                ).status,
            ).toBe(401);
            expect((await request(server()).delete(mineUrl(game))).status).toBe(
                401,
            );
        });

        it("returns 404 for an unknown game or option", async () => {
            const user = await createUser();
            const game = await createGame();
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
            });
            currentUser = user;

            const unknownGame = await request(server())
                .put(mineUrl(9_999_999_998))
                .send({ coverOptionId: option.id });
            expect(unknownGame.status).toBe(404);

            const unknownOption = await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: 9_999_999_997 });
            expect(unknownOption.status).toBe(404);
        });

        it("chooses a cover for a game outside the library", async () => {
            const user = await createUser();
            const game = await createGame();
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Localized,
            });
            currentUser = user;

            const response = await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: option.id });

            expect(response.status).toBe(200);
            expect(
                await source.getRepository(Library).countBy({ userId: user }),
            ).toBe(0);
            expect(
                await choiceRepository().findOneBy({
                    userId: user,
                    gameId: game,
                }),
            ).toMatchObject({ coverOptionId: option.id });
        });

        it("removes a choice, and removing a missing choice succeeds", async () => {
            const user = await createUser();
            const game = await createGame();
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
            });
            currentUser = user;
            await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: option.id });

            expect((await request(server()).delete(mineUrl(game))).status).toBe(
                200,
            );
            expect(await choiceRepository().countBy({ userId: user })).toBe(0);
            expect((await request(server()).delete(mineUrl(game))).status).toBe(
                200,
            );
        });

        it("does not touch the game's collection entry", async () => {
            const user = await createUser();
            const game = await createGame();
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
            });
            await source.query("INSERT INTO library (userId) VALUES (?)", [
                user,
            ]);
            const entryId = randomUUID();
            await source.query(
                "INSERT INTO collection_entry (id, gameId, libraryUserId, status) VALUES (?, ?, ?, 'planned')",
                [entryId, game, user],
            );
            const [before] = await source.query(
                "SELECT updatedAt FROM collection_entry WHERE id = ?",
                [entryId],
            );
            currentUser = user;

            const response = await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: option.id });

            expect(response.status).toBe(200);
            const [after] = await source.query(
                "SELECT updatedAt FROM collection_entry WHERE id = ?",
                [entryId],
            );
            expect(new Date(after.updatedAt).getTime()).toBe(
                new Date(before.updatedAt).getTime(),
            );
        });

        it("removes the user's choices when the profile is deleted", async () => {
            const user = await createUser();
            const game = await createGame();
            const option = await createOption({
                gameId: game,
                kind: GameCoverKind.Alternative,
            });
            currentUser = user;
            await request(server())
                .put(mineUrl(game))
                .send({ coverOptionId: option.id });
            const profileService = new ProfileService(
                source.getRepository(Profile),
                source.getRepository(ProfileVideo),
                {} as never,
                { delete: jest.fn() } as never,
            );

            await profileService.deleteByUserId(user);

            expect(
                await source.getRepository(Profile).countBy({ userId: user }),
            ).toBe(0);
            expect(await choiceRepository().countBy({ userId: user })).toBe(0);
            expect(await optionRepository().countBy({ id: option.id })).toBe(1);
        });
    });

    it("defaults a new profile's display mode to any", async () => {
        const user = await createUser();

        const profile = await source
            .getRepository(Profile)
            .findOneByOrFail({ userId: user });

        expect(profile.customCoverMode).toBe(CustomCoverMode.Any);
    });
});
