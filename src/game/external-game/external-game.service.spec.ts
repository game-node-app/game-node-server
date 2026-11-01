import { ConflictException } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { ExternalGameService } from "./external-game.service";
import { ExternalGameMappingsService } from "./external-game-mappings.service";
import { runPlayerSyncAttempt } from "../../sync/player-sync-attempt";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";

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

test("concurrent unmapped registration tolerates only duplicate identities", async () => {
    const duplicate = new QueryFailedError(
        "INSERT",
        [],
        Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" }),
    );
    const insert = jest
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(duplicate);
    const service = new ExternalGameService({} as any, { insert } as any);
    await Promise.all([
        service.registerUnmappedGame("42", EGameExternalGameCategory.Steam),
        service.registerUnmappedGame("42", EGameExternalGameCategory.Steam),
    ]);
    const failure = new Error("database unavailable");
    insert.mockRejectedValueOnce(failure);
    await expect(
        service.registerUnmappedGame("42", EGameExternalGameCategory.Steam),
    ).rejects.toBe(failure);
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
    await expect(exhausted.service.insertReserved({ uid: "a" })).rejects.toBeInstanceOf(
        QueryFailedError,
    );
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
    expect(unmapped.update).toHaveBeenCalledWith({ id: 9 }, { isActive: false });
});

test("submit corrects an existing non-IGDB mapping in place", async () => {
    const { service, insert, update } = submitFixture([
        { id: 1e12 + 5, origin: "curated", gameId: 1 },
    ]);
    await service.submit(dto);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
        { id: 1e12 + 5 },
        { gameId: 7, url: dto.sourceUrl },
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
