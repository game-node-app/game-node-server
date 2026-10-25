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
