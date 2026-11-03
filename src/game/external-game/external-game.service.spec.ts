import { ConflictException, NotFoundException } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { ExternalGameService } from "./external-game.service";
import { ExternalGameMappingsService } from "./external-game-mappings.service";
import { runPlayerSyncAttempt } from "../../sync/player-sync-attempt";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";

test("missing source IDs do not block valid mappings or unmapped registrations", async () => {
    const find = jest.fn(async (_options: any) => [{ uid: "valid" }]);
    const query = jest.fn(async (_sql: string, _params: any) => undefined);
    const service = new ExternalGameService({ find } as any, { query } as any);
    const ids = [undefined, null, "", "  ", "valid"] as string[];

    await service.getExternalGamesForSourceIds(
        ids,
        EGameExternalGameCategory.Microsoft,
    );
    expect(find.mock.calls[0][0].where.uid.value).toEqual(["valid"]);

    await service.registerUnmappedGames(
        EGameExternalGameCategory.Microsoft,
        ids.map((sourceUid) => ({ sourceUid, name: "Game" })),
        "user",
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual([
        [["valid", EGameExternalGameCategory.Microsoft, "Game"]],
    ]);
    expect(query.mock.calls[1][1]).toEqual([
        "user",
        EGameExternalGameCategory.Microsoft,
        ["valid"],
    ]);

    find.mockClear();
    query.mockClear();
    expect(
        await service.getExternalGamesForSourceIds(
            ids.slice(0, 4),
            EGameExternalGameCategory.Microsoft,
        ),
    ).toEqual([]);
    await service.registerUnmappedGames(
        EGameExternalGameCategory.Microsoft,
        ids.slice(0, 4).map((sourceUid) => ({ sourceUid })),
        "user",
    );
    expect(find).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
});

test("mapping reads use bounded distinct IDs and preserve source order within one attempt", async () => {
    const find = jest.fn(async ({ where }) =>
        where.uid.value.toReversed().map((uid: string) => ({ uid })),
    );
    const service = new ExternalGameService({ find } as any, {} as any);
    const ids = Array.from({ length: 1001 }, (_, index) => String(index));
    await runPlayerSyncAttempt(async () => {
        const first = await service.getExternalGamesForSourceIds(
            [...ids, "0"],
            EGameExternalGameCategory.Steam,
        );
        const second = await service.getExternalGamesForSourceIds(
            [...ids, "0"],
            EGameExternalGameCategory.Steam,
        );
        expect(first.map((row) => row.uid)).toEqual(ids);
        expect(second).toEqual(first);
    });
    expect(find).toHaveBeenCalledTimes(3);
    expect(
        find.mock.calls.map(([options]) => options.where.uid.value.length),
    ).toEqual([500, 500, 1]);
});

test("provider snapshots retain all mappings while normal discovery stays compatible", async () => {
    const find = jest.fn().mockResolvedValue([
        { id: 1, uid: "a", gameId: 7 },
        { id: 2, uid: "a", gameId: 7 },
        { id: 3, uid: "b", gameId: 8 },
    ]);
    const service = new ExternalGameService({ find } as any, {} as any);
    const all = await service.getExternalGamesForSourceIds(
        ["b", "a"],
        EGameExternalGameCategory.Steam,
        true,
    );
    expect(all.map((item) => item.id)).toEqual([3, 1, 2]);
    const legacy = await service.getExternalGamesForSourceIds(
        ["a"],
        EGameExternalGameCategory.Steam,
    );
    expect(legacy.map((item) => item.id)).toEqual([2]);
});

test("PSN mapping upsert awaits the atomic unique-identity write", async () => {
    let finish!: () => void;
    const upsert = jest.fn(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    const service = new ExternalGameMappingsService({ upsert } as any);
    const mapping = {
        externalGameId: 1,
        npCommunicationId: "comm",
        npServiceName: "trophy2",
    };
    let completed = false;
    const pending = service.upsertPsnMappings(mapping).then(() => {
        completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish();
    await pending;
    expect(upsert).toHaveBeenCalledWith(mapping, [
        "externalGameId",
        "npCommunicationId",
        "npServiceName",
    ]);
});

const duplicateKey = () =>
    new QueryFailedError(
        "INSERT",
        [],
        Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" }),
    );

function submitFixture(existing: any[], max: string | null = "3200000") {
    const insert = jest.fn().mockResolvedValue({});
    const update = jest.fn();
    const getRawOne = jest.fn().mockResolvedValue({ max });
    const repo = {
        findBy: jest.fn().mockResolvedValue(existing),
        insert,
        update,
        createQueryBuilder: () => ({
            select: () => ({ getRawOne }),
        }),
    };
    const unmapped = {
        findOneBy: jest.fn().mockResolvedValue({ id: 9 }),
        update: jest.fn(),
    };
    return {
        service: new ExternalGameService(repo as any, unmapped as any),
        insert,
        update,
        getRawOne,
        unmapped,
    };
}

const dto = {
    sourceId: "ns",
    sourceUrl: "https://store.epicgames.com/p/x",
    gameId: 7,
    category: EGameExternalGameCategory.EpicGamesNamespace,
};

test("reserved IDs start at 1e12 and continue past the highest reserved ID", async () => {
    const first = submitFixture([]);
    await expect(first.service.insertReserved({ uid: "a" })).resolves.toBe(
        1e12,
    );
    const next = submitFixture([], String(1e12 + 41));
    await expect(next.service.insertReserved({ uid: "a" })).resolves.toBe(
        1e12 + 42,
    );
});

test("reserved ID insert retries duplicate keys at most five times", async () => {
    const retried = submitFixture([]);
    retried.insert.mockRejectedValueOnce(duplicateKey());
    await retried.service.insertReserved({ uid: "a" });
    expect(retried.insert).toHaveBeenCalledTimes(2);

    const exhausted = submitFixture([]);
    exhausted.insert.mockRejectedValue(duplicateKey());
    await expect(
        exhausted.service.insertReserved({ uid: "a" }),
    ).rejects.toBeInstanceOf(QueryFailedError);
    expect(exhausted.insert).toHaveBeenCalledTimes(5);
});

test("submit adds a curated row next to the game's other mappings and resolves the unmapped entry", async () => {
    const { service, insert, update, unmapped } = submitFixture([]);
    await service.submit(dto);
    expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
            id: 1e12,
            uid: "ns",
            gameId: 7,
            origin: "curated",
        }),
    );
    expect(update).not.toHaveBeenCalled();
    expect(unmapped.update).toHaveBeenCalledWith(
        { id: 9 },
        { isActive: false },
    );
});

test("submit corrects an existing non-IGDB mapping in place", async () => {
    const { service, insert, update } = submitFixture([
        { id: 1e12 + 5, origin: "curated", gameId: 1 },
    ]);
    await service.submit(dto);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
        { id: 1e12 + 5 },
        { gameId: 7, url: dto.sourceUrl, origin: "curated" },
    );
});

test("submit refuses to shadow an IGDB mapping", async () => {
    const { service, insert, update, unmapped } = submitFixture([
        { id: 5, origin: "igdb" },
    ]);
    await expect(service.submit(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(unmapped.update).not.toHaveBeenCalled();
});

test("submit turns a corrected agent mapping into a curated one with the same id", async () => {
    const { service, insert, update } = submitFixture([
        { id: 1e12 + 6, origin: "agent", gameId: 1 },
    ]);
    await service.submit(dto);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
        { id: 1e12 + 6 },
        expect.objectContaining({ gameId: 7, origin: "curated" }),
    );
});

describe("mapUnmappedGame", () => {
    const entry = {
        id: 9,
        sourceUid: "412020",
        category: EGameExternalGameCategory.Steam,
        isActive: true,
    };
    const build = ({
        active = entry as any,
        game = { id: 7, name: "Metro Exodus" } as any,
        mapped = [] as { gameId: number }[],
    } = {}) => {
        const insert = jest.fn().mockResolvedValue({});
        const repo = {
            insert,
            find: jest.fn().mockResolvedValue(mapped),
            manager: { findOne: jest.fn().mockResolvedValue(game) },
            createQueryBuilder: () => ({
                select: () => ({
                    getRawOne: jest.fn().mockResolvedValue({ max: null }),
                }),
            }),
        };
        const unmapped = {
            findOneBy: jest.fn().mockResolvedValue(active),
            update: jest.fn(),
        };
        return {
            service: new ExternalGameService(repo as any, unmapped as any),
            insert,
            unmapped,
            repo,
        };
    };

    it("writes an agent mapping with the store URL and deactivates the entry", async () => {
        const { service, insert, unmapped } = build();
        await expect(service.mapUnmappedGame(9, 7)).resolves.toEqual({
            id: 7,
            name: "Metro Exodus",
        });
        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: "412020",
                category: EGameExternalGameCategory.Steam,
                gameId: 7,
                origin: "agent",
                url: "https://store.steampowered.com/app/412020",
            }),
        );
        expect(unmapped.update).toHaveBeenCalledWith(
            { id: 9 },
            { isActive: false },
        );
    });

    it("resolves the entry without writing when the mapping already points at the game", async () => {
        const { service, insert, unmapped } = build({
            mapped: [{ gameId: 3 }, { gameId: 7 }],
        });
        await expect(service.mapUnmappedGame(9, 7)).resolves.toEqual({
            id: 7,
            name: "Metro Exodus",
        });
        expect(insert).not.toHaveBeenCalled();
        expect(unmapped.update).toHaveBeenCalledWith(
            { id: 9 },
            { isActive: false },
        );
    });

    it.each([
        ["an inactive or unknown entry", { active: null }, NotFoundException],
        ["an unknown game", { game: null }, NotFoundException],
        [
            "a mapping to another game",
            { mapped: [{ gameId: 3 }] },
            ConflictException,
        ],
    ])("refuses %s and changes nothing", async (_name, options, error) => {
        const { service, insert, unmapped } = build(options as any);
        await expect(service.mapUnmappedGame(9, 7)).rejects.toBeInstanceOf(
            error,
        );
        expect(insert).not.toHaveBeenCalled();
        expect(unmapped.update).not.toHaveBeenCalled();
    });
});
