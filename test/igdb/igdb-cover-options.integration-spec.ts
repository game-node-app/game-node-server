import { randomBytes, randomUUID } from "node:crypto";
import { IgdbCatalogState } from "../../src/sync/igdb/catalog/entities/igdb-catalog-state.entity";
import { GameArtwork } from "../../src/game/game-repository/entities/game-artwork.entity";
import { GameCover } from "../../src/game/game-repository/entities/game-cover.entity";
import { Game } from "../../src/game/game-repository/entities/game.entity";
import { GameCoverOption } from "../../src/game/game-cover/entities/game-cover-option.entity";
import { UserGameCover } from "../../src/game/game-cover/entities/user-game-cover.entity";
import {
    GameCoverKind,
    GameCoverOrigin,
} from "../../src/game/game-cover/game-cover.constants";
import { Profile } from "../../src/profile/entities/profile.entity";
import { fixtureRuntime } from "./helpers/fixture-runtime";

const createRuntime = () =>
    fixtureRuntime(
        { seed: 42, games: 1 },
        {
            tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
            trackPages: false,
        },
    );

async function initialSweep(
    runtime: Awaited<ReturnType<typeof createRuntime>>,
) {
    const claim = (await runtime.state.claimRun())!;
    await runtime.state.releaseOwnership(claim as any);
    await runtime.runner.run(claim.runId!);
}

/** Puts the completed run back on a chosen endpoint and page, then claims it. */
async function claimPage(
    runtime: Awaited<ReturnType<typeof createRuntime>>,
    endpoint: string,
    committedId: number,
    upperId: number,
) {
    await runtime.source.getRepository(IgdbCatalogState).update(1, {
        status: "running",
        nextEligibleAt: new Date(0),
        sweepEndpoint: endpoint,
        committedId,
        upperId,
        ownerToken: null,
        leaseExpiresAt: null,
    });
    const claim = (await runtime.state.claimRun())!;
    await runtime.state.releaseOwnership(claim as any);
    return claim.runId!;
}

const close = async (runtime: Awaited<ReturnType<typeof createRuntime>>) => {
    await runtime.queue.obliterate({ force: true });
    await runtime.close();
};

it("stores localized and alternative or historical covers without refreshing their parent game", async () => {
    const runtime = await createRuntime();
    try {
        await initialSweep(runtime);
        const page = [
            // Primary cover: keeps today's comparison and is not an option.
            { id: 451, game: 45, image_type: 9, checksum: "cover-45" },
            { id: 7001, game: 45, image_type: 9, checksum: "historical" },
            { id: 7002, game: 45, image_type: 10, checksum: "alternative" },
            { id: 7003, game_localization: 40272, checksum: "localized" },
        ];
        jest.spyOn(runtime.client, "fetchSweepPage").mockImplementation(
            async (entry, cursor) =>
                entry.endpoint === "covers" && cursor === 400 ? page : [],
        );
        const fetch = jest
            .spyOn(runtime.client, "fetchByIds")
            .mockResolvedValue([]);
        const optionFetch = jest
            .spyOn(runtime.client, "fetchOptionSources")
            .mockImplementation(async (_entry, ids) =>
                ids.map((id) =>
                    id === 7003
                        ? {
                              id,
                              game_localization: {
                                  game: 45,
                                  region: { name: "Japan" },
                              },
                              image_id: "localized",
                              checksum: "localized",
                          }
                        : {
                              id,
                              game: 45,
                              image_id:
                                  id === 7001 ? "historical" : "alternative",
                              checksum:
                                  id === 7001 ? "historical" : "alternative",
                          },
                ),
            );

        await runtime.runner.run(await claimPage(runtime, "covers", 400, 8000));

        expect((await runtime.state.readStatus()).status).toBe("completed");
        const options = await runtime.source
            .getRepository(GameCoverOption)
            .find({ order: { igdbId: "ASC" } });
        expect(
            options.map((option) => [
                Number(option.igdbId),
                option.kind,
                option.origin,
                option.label,
                option.imageId,
                option.gameId,
            ]),
        ).toEqual([
            [
                7001,
                GameCoverKind.Historical,
                GameCoverOrigin.Cover,
                null,
                "historical",
                45,
            ],
            [
                7002,
                GameCoverKind.Alternative,
                GameCoverOrigin.Cover,
                null,
                "alternative",
                45,
            ],
            [
                7003,
                GameCoverKind.Localized,
                GameCoverOrigin.Cover,
                "Japan",
                "localized",
                45,
            ],
        ]);
        expect(optionFetch).toHaveBeenCalledWith(
            expect.objectContaining({ endpoint: "covers" }),
            [7001, 7002, 7003],
            expect.any(AbortSignal),
        );
        expect(
            fetch.mock.calls.filter(([entry]) => entry.endpoint === "games"),
        ).toEqual([]);

        // An unchanged replay fetches and writes nothing.
        optionFetch.mockClear();
        fetch.mockClear();
        await runtime.runner.run(await claimPage(runtime, "covers", 400, 8000));
        expect(optionFetch).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(
            await runtime.source.getRepository(GameCoverOption).count(),
        ).toBe(3);
    } finally {
        await close(runtime);
    }
}, 120000);

it("stores alternative and historical artworks, ignores other artwork types and keeps them on the normal path", async () => {
    const runtime = await createRuntime();
    try {
        await initialSweep(runtime);
        await runtime.source.getRepository(GameArtwork).insert([
            {
                id: 8101,
                game: { id: 45 },
                imageId: "art-alternative",
                checksum: "alternative",
            },
            {
                id: 8102,
                game: { id: 45 },
                imageId: "art-historical",
                checksum: "historical",
            },
            {
                id: 8103,
                game: { id: 45 },
                imageId: "art-other",
                checksum: "other",
            },
        ] as any);
        const page = [
            { id: 8101, game: 45, artwork_type: 9, checksum: "alternative" },
            { id: 8102, game: 45, artwork_type: 10, checksum: "historical" },
            { id: 8103, game: 45, artwork_type: 1, checksum: "other" },
        ];
        jest.spyOn(runtime.client, "fetchSweepPage").mockImplementation(
            async (entry, cursor) =>
                entry.endpoint === "artworks" && cursor === 8000 ? page : [],
        );
        const fetch = jest
            .spyOn(runtime.client, "fetchByIds")
            .mockResolvedValue([]);
        jest.spyOn(runtime.client, "fetchOptionSources").mockImplementation(
            async (_entry, ids) =>
                ids.map((id) => ({
                    id,
                    game: 45,
                    image_id:
                        id === 8101 ? "art-alternative" : "art-historical",
                    checksum: id === 8101 ? "alternative" : "historical",
                })),
        );

        await runtime.runner.run(
            await claimPage(runtime, "artworks", 8000, 9000),
        );

        expect((await runtime.state.readStatus()).status).toBe("completed");
        const options = await runtime.source
            .getRepository(GameCoverOption)
            .find({ order: { igdbId: "ASC" } });
        expect(
            options.map((option) => [
                Number(option.igdbId),
                option.kind,
                option.origin,
                option.imageId,
            ]),
        ).toEqual([
            [
                8101,
                GameCoverKind.Alternative,
                GameCoverOrigin.Artwork,
                "art-alternative",
            ],
            [
                8102,
                GameCoverKind.Historical,
                GameCoverOrigin.Artwork,
                "art-historical",
            ],
        ]);
        expect(
            fetch.mock.calls.filter(([entry]) => entry.endpoint === "games"),
        ).toEqual([]);
    } finally {
        await close(runtime);
    }
}, 120000);

it("skips an option source whose game is absent and stores it on a later sweep", async () => {
    const runtime = await createRuntime();
    try {
        await initialSweep(runtime);
        const page = [
            { id: 7202, game_localization: 40272, checksum: "localized" },
        ];
        jest.spyOn(runtime.client, "fetchSweepPage").mockImplementation(
            async (entry, cursor) =>
                entry.endpoint === "covers" && cursor === 400 ? page : [],
        );
        jest.spyOn(runtime.client, "fetchByIds").mockResolvedValue([]);
        jest.spyOn(runtime.client, "fetchOptionSources").mockImplementation(
            async (_entry, ids) =>
                ids.map((id) => ({
                    id,
                    game_localization: {
                        game: { id: 77777 },
                        region: { name: "Europe" },
                    },
                    image_id: "localized",
                    checksum: "localized",
                })),
        );

        await runtime.runner.run(await claimPage(runtime, "covers", 400, 8000));
        expect((await runtime.state.readStatus()).status).toBe("completed");
        expect(
            await runtime.source.getRepository(GameCoverOption).count(),
        ).toBe(0);

        await runtime.source
            .getRepository(Game)
            .insert({ id: 77777, name: "Later game", slug: "later-game" });
        await runtime.runner.run(await claimPage(runtime, "covers", 400, 8000));

        expect(
            await runtime.source
                .getRepository(GameCoverOption)
                .findOneByOrFail({
                    origin: GameCoverOrigin.Cover,
                    igdbId: 7202,
                }),
        ).toMatchObject({
            gameId: 77777,
            kind: GameCoverKind.Localized,
            label: "Europe",
            imageId: "localized",
        });
    } finally {
        await close(runtime);
    }
}, 120000);

it("updates a changed source in place, keeps user choices and creates no duplicates on replay", async () => {
    const runtime = await createRuntime();
    try {
        await initialSweep(runtime);
        const inserted = await runtime.source
            .getRepository(GameCoverOption)
            .insert({
                gameId: 45,
                kind: GameCoverKind.Alternative,
                origin: GameCoverOrigin.Cover,
                igdbId: 7301,
                imageId: "old",
                url: "https://images.test/old.jpg",
                checksum: "old",
            });
        const coverOptionId = Number(inserted.identifiers[0].id);
        const userId = randomUUID();
        await runtime.source.getRepository(Profile).insert({
            userId,
            username: `cover_${userId.slice(0, 8)}`,
        });
        await runtime.source.getRepository(UserGameCover).insert({
            userId,
            gameId: 45,
            coverOptionId,
        });
        const page = [{ id: 7301, game: 45, image_type: 10, checksum: "new" }];
        jest.spyOn(runtime.client, "fetchSweepPage").mockImplementation(
            async (entry, cursor) =>
                entry.endpoint === "covers" && cursor === 400 ? page : [],
        );
        jest.spyOn(runtime.client, "fetchByIds").mockResolvedValue([]);
        const optionFetch = jest
            .spyOn(runtime.client, "fetchOptionSources")
            .mockImplementation(async (_entry, ids) =>
                ids.map((id) => ({
                    id,
                    game: 45,
                    image_id: "new",
                    url: "https://images.test/new.jpg",
                    checksum: "new",
                })),
            );

        await runtime.runner.run(await claimPage(runtime, "covers", 400, 8000));

        const updated = await runtime.source
            .getRepository(GameCoverOption)
            .findOneByOrFail({
                origin: GameCoverOrigin.Cover,
                igdbId: 7301,
            });
        expect(Number(updated.id)).toBe(coverOptionId);
        expect(updated).toMatchObject({
            gameId: 45,
            kind: GameCoverKind.Alternative,
            imageId: "new",
            checksum: "new",
        });
        expect(
            await runtime.source.getRepository(GameCoverOption).count(),
        ).toBe(1);
        expect(
            await runtime.source.getRepository(UserGameCover).findOneByOrFail({
                userId,
                gameId: 45,
            }),
        ).toMatchObject({ coverOptionId });

        optionFetch.mockClear();
        await runtime.runner.run(await claimPage(runtime, "covers", 400, 8000));
        expect(optionFetch).not.toHaveBeenCalled();
        expect(
            await runtime.source.getRepository(GameCoverOption).count(),
        ).toBe(1);
        expect(
            await runtime.source.getRepository(UserGameCover).countBy({
                userId,
            }),
        ).toBe(1);

        // A sweep that no longer sees the source keeps the option.
        jest.spyOn(runtime.client, "fetchSweepPage").mockImplementation(
            async () => [],
        );
        await runtime.runner.run(await claimPage(runtime, "covers", 400, 8000));
        expect(
            await runtime.source
                .getRepository(GameCoverOption)
                .existsBy({ origin: GameCoverOrigin.Cover, igdbId: 7301 }),
        ).toBe(true);
    } finally {
        await close(runtime);
    }
}, 120000);
