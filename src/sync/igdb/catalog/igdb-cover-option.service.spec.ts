import { GameCover } from "../../../game/game-repository/entities/game-cover.entity";
import { GameCoverOption } from "../../../game/game-cover/entities/game-cover-option.entity";
import {
    GameCoverKind,
    GameCoverOrigin,
} from "../../../game/game-cover/game-cover.constants";
import { IgdbCoverOptionService } from "./igdb-cover-option.service";
import { IGDB_SYNC_ENDPOINTS } from "./igdb-sync-endpoints";

const entry = (endpoint: string) =>
    IGDB_SYNC_ENDPOINTS.find((item) => item.endpoint === endpoint)!;
const owner = {
    runId: "run",
    ownerToken: "token",
    ownerGeneration: 1,
};

function fixture(
    stored: any[] = [],
    primary: number[] = [],
    games: number[] = [],
) {
    const optionRepository = {
        find: jest.fn().mockResolvedValue(stored),
    };
    const coverRepository = {
        find: jest.fn().mockResolvedValue(primary.map((id) => ({ id }))),
    };
    const gameRepository = {
        find: jest.fn().mockResolvedValue(games.map((id) => ({ id }))),
    };
    const upsert = jest.fn().mockResolvedValue(undefined);
    const manager = { getRepository: () => ({ upsert }) };
    const source = {
        getRepository: jest.fn((entity: unknown) => {
            if (entity === GameCoverOption) return optionRepository;
            if (entity === GameCover) return coverRepository;
            return gameRepository;
        }),
    };
    const client = {
        fetchOptionSources: jest.fn().mockResolvedValue([]),
    };
    const transactions = {
        gameTransaction: jest.fn(
            async (_owner: unknown, work: (manager: any) => Promise<void>) =>
                work(manager),
        ),
    };
    const service = new IgdbCoverOptionService(
        source as any,
        client as any,
        transactions as any,
    );
    return {
        service,
        client,
        optionRepository,
        coverRepository,
        gameRepository,
        upsert,
        transactions,
    };
}

const detail = (values: Record<string, unknown>) => ({
    alpha_channel: false,
    animated: false,
    height: 150,
    width: 100,
    url: "https://images.test/cover.jpg",
    ...values,
});

it("classifies localized, historical and alternative covers and leaves primary covers on the normal path", async () => {
    const f = fixture([], [4], [45]);
    f.client.fetchOptionSources.mockResolvedValue([
        detail({
            id: 1,
            game_localization: { game: 45, region: { name: "Japan" } },
            image_id: "localized",
            checksum: "localized",
        }),
        detail({
            id: 2,
            game: 45,
            image_id: "historical",
            checksum: "historical",
        }),
        detail({
            id: 3,
            game: 45,
            image_id: "alternative",
            checksum: "alternative",
        }),
    ]);
    const rows = [
        { id: 1, game_localization: 40272, checksum: "localized" },
        { id: 2, game: 45, image_type: 9, checksum: "historical" },
        { id: 3, game: 45, image_type: 10, checksum: "alternative" },
        { id: 4, game: 45, image_type: 9, checksum: "primary" },
        { id: 5, game: 45, image_type: 8, checksum: "main" },
    ];

    const remaining = await f.service.syncPage(entry("covers"), rows, owner);

    expect(remaining.map((row) => row.id)).toEqual([4, 5]);
    expect(f.coverRepository.find).toHaveBeenCalledTimes(1);
    expect(f.client.fetchOptionSources).toHaveBeenCalledWith(
        entry("covers"),
        [1, 2, 3],
        undefined,
    );
    expect(f.upsert).toHaveBeenCalledWith(
        [
            expect.objectContaining({
                gameId: 45,
                kind: GameCoverKind.Localized,
                origin: GameCoverOrigin.Cover,
                igdbId: 1,
                label: "Japan",
                imageId: "localized",
                checksum: "localized",
            }),
            expect.objectContaining({
                gameId: 45,
                kind: GameCoverKind.Historical,
                origin: GameCoverOrigin.Cover,
                igdbId: 2,
                label: null,
                imageId: "historical",
            }),
            expect.objectContaining({
                gameId: 45,
                kind: GameCoverKind.Alternative,
                origin: GameCoverOrigin.Cover,
                igdbId: 3,
                imageId: "alternative",
            }),
        ],
        ["origin", "igdbId"],
    );
    expect(f.transactions.gameTransaction).toHaveBeenCalledWith(
        owner,
        expect.any(Function),
    );
});

it("does not fetch or write unchanged option sources", async () => {
    const f = fixture(
        [
            { igdbId: 1, checksum: "localized" },
            { igdbId: 2, checksum: "historical" },
        ],
        [],
        [45],
    );
    const rows = [
        { id: 1, game_localization: 40272, checksum: "localized" },
        { id: 2, game: 45, image_type: 9, checksum: "historical" },
    ];

    const remaining = await f.service.syncPage(entry("covers"), rows, owner);

    expect(remaining).toEqual([]);
    expect(f.client.fetchOptionSources).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
});

it("skips an option source whose game is absent locally", async () => {
    const f = fixture([], [], []);
    f.client.fetchOptionSources.mockResolvedValue([
        detail({
            id: 1,
            game_localization: { game: 999, region: { name: "Europe" } },
            image_id: "localized",
            checksum: "localized",
        }),
    ]);

    const remaining = await f.service.syncPage(
        entry("covers"),
        [{ id: 1, game_localization: 40272, checksum: "localized" }],
        owner,
    );

    expect(remaining).toEqual([]);
    expect(f.transactions.gameTransaction).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
});

it("stores alternative and historical artworks but keeps every artwork on the normal path", async () => {
    const f = fixture([], [], [45]);
    f.client.fetchOptionSources.mockResolvedValue([
        detail({
            id: 11,
            game: 45,
            image_id: "alternative",
            checksum: "alternative",
        }),
        detail({
            id: 12,
            game: 45,
            image_id: "historical",
            checksum: "historical",
        }),
    ]);
    const rows = [
        { id: 11, game: 45, artwork_type: 9, checksum: "alternative" },
        { id: 12, game: 45, artwork_type: 10, checksum: "historical" },
        { id: 13, game: 45, artwork_type: 1, checksum: "artwork" },
    ];

    const remaining = await f.service.syncPage(entry("artworks"), rows, owner);

    expect(remaining).toEqual(rows);
    expect(f.coverRepository.find).not.toHaveBeenCalled();
    expect(f.client.fetchOptionSources).toHaveBeenCalledWith(
        entry("artworks"),
        [11, 12],
        undefined,
    );
    expect(f.upsert).toHaveBeenCalledWith(
        [
            expect.objectContaining({
                gameId: 45,
                kind: GameCoverKind.Alternative,
                origin: GameCoverOrigin.Artwork,
                igdbId: 11,
                label: null,
            }),
            expect.objectContaining({
                gameId: 45,
                kind: GameCoverKind.Historical,
                origin: GameCoverOrigin.Artwork,
                igdbId: 12,
            }),
        ],
        ["origin", "igdbId"],
    );
});

it("does nothing for endpoints without cover option sources", async () => {
    const f = fixture();
    const rows = [{ id: 1, game: 45, checksum: "cover" }];

    expect(await f.service.syncPage(entry("screenshots"), rows, owner)).toBe(
        rows,
    );
    expect(f.client.fetchOptionSources).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
});

it("accepts expanded game references on localized covers", async () => {
    const f = fixture([], [], [45]);
    f.client.fetchOptionSources.mockResolvedValue([
        detail({
            id: 1,
            game_localization: { game: { id: 45 }, region: { name: "Korea" } },
            image_id: "localized",
            checksum: "localized",
        }),
    ]);

    await f.service.syncPage(
        entry("covers"),
        [{ id: 1, game_localization: 40272, checksum: "localized" }],
        owner,
    );

    expect(f.upsert).toHaveBeenCalledWith(
        [expect.objectContaining({ gameId: 45, label: "Korea" })],
        ["origin", "igdbId"],
    );
});
