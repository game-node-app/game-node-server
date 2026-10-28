import { ConnectionProviderRegistry } from "../../connection/connection-provider.registry";
jest.mock("typeorm-transactional", () => ({
    Transactional:
        () =>
        (_target: object, _name: string, descriptor: PropertyDescriptor) =>
            descriptor,
}));
import {
    playerStateFixture,
    playerOwner,
} from "../../sync/player-data/player-sync.fixture";
import { HttpException } from "@nestjs/common";
import { ImporterWatchProcessor } from "./importer-watch.processor";
import { ImporterService } from "../importer.service";
import { EImporterSource } from "../importer.constants";
import { IMPORTER_WATCH_JOB_NAME } from "./importer-watch.constants";
import * as outboxModule from "../../notifications/notifications-outbox.service";

it("a complete empty discovery completes the worker without treating other 404s as success", async () => {
    const importer: ImporterService = Object.assign(
        Object.create(ImporterService.prototype),
        {
            findUnprocessedCandidates: jest.fn().mockResolvedValue([]),
        },
    );
    const save = jest.fn();
    const processor = new ImporterWatchProcessor(
        { save } as any,
        { save, find: jest.fn().mockResolvedValue([]) } as any,
        importer,
        {} as any,
        {} as any,
    );
    const job = {
        name: IMPORTER_WATCH_JOB_NAME,
        data: {
            userId: "user",
            source: EImporterSource.STEAM,
            owner: playerOwner("user"),
        },
    } as any;
    await expect(processor.run(job.data)).resolves.toBe("empty");
    expect(save).not.toHaveBeenCalled();
    const missingConnection = new HttpException("Connection not found", 404);
    jest.spyOn(importer, "findUnprocessedCandidates").mockRejectedValue(
        missingConnection,
    );
    await expect(processor.run(job.data)).rejects.toBe(missingConnection);
});

function recoveryFixture(size = 2) {
    const games = Array.from({ length: size }, (_, index) => ({
        id: index + 1,
        gameId: index + 1,
        preferredPlatformId: 6,
    }));
    const processed = new Set<number>();
    const ignored = new Set<number>();
    const notified = new Map<number, any>();
    const notifications: any[] = [];
    const outboxIntents: any[] = [];
    const notificationRepository = {
        manager: {
            getRepository: jest.fn(),
        },
        find: jest.fn(async () =>
            notifications.filter((row) => row.pendingDelivery),
        ),
        save: jest.fn(async (row) => {
            const saved = { ...row, id: notifications.length + 1 };
            notifications.push(saved);
            return saved;
        }),
        update: jest.fn(async (where, patch) => {
            Object.assign(
                notifications.find((row) => row.id === where.id)!,
                patch,
            );
        }),
    };
    jest.spyOn(outboxModule, "appendNotificationIntent").mockImplementation(
        async (_manager, intent) => {
            outboxIntents.push(intent);
            return {} as any;
        },
    );
    const importer = {
        lockLibrary: jest.fn(),
        findUnprocessedCandidates: jest.fn(async () => {
            return games.filter(
                (game) => !processed.has(game.id) && !ignored.has(game.id),
            );
        }),
        isProcessedOrIgnored: jest.fn(
            async (_user, id) => processed.has(id) || ignored.has(id),
        ),
        markProcessed: jest.fn(async (_user, id) => {
            processed.add(id);
        }),
    };
    const createForImport = jest.fn().mockResolvedValue("imported");
    const processor = new ImporterWatchProcessor(
        {
            findBy: jest.fn(async () => [...notified.values()]),
            upsert: jest.fn(async (row) => {
                notified.set(row.gameExternalGameId, row);
            }),
        } as any,
        notificationRepository as any,
        importer as any,
        {
            findOneByUserIdAndType: jest.fn().mockResolvedValue({
                isAutoImportEnabled: true,
                autoImportCollectionId: "destination",
            }),
        } as any,
        { createForImport } as any,
    );
    return {
        processor,
        processed,
        ignored,
        notified,
        notifications,
        outboxIntents,
        notificationRepository,
        importer,
        createForImport,
    };
}
const data = { userId: "user", source: EImporterSource.STEAM };

test("notified failed games retry independently without duplicate discovery notifications", async () => {
    const fixture = recoveryFixture();
    fixture.createForImport
        .mockResolvedValueOnce("imported")
        .mockRejectedValueOnce(new Error("temporary"));
    await expect(fixture.processor.run(data)).rejects.toThrow(
        "1 automatic imports failed",
    );
    expect(fixture.processed).toEqual(new Set([1]));
    expect(fixture.notified.get(2).autoImportRetryable).toBe(true);
    expect(fixture.notifications[0]).toMatchObject({
        autoImportedCount: 1,
        autoImportFailedCount: 1,
    });
    await expect(fixture.processor.run(data)).resolves.toBe("complete");
    expect(fixture.processed).toEqual(new Set([1, 2]));
    expect(fixture.createForImport).toHaveBeenCalledTimes(3);
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.outboxIntents).toHaveLength(1);
});

test("discovery commits outbox intent without repeating imports or using legacy publisher", async () => {
    const fixture = recoveryFixture();
    await expect(fixture.processor.run(data)).resolves.toBe("complete");
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.outboxIntents).toHaveLength(1);
    expect(fixture.createForImport).toHaveBeenCalledTimes(2);

    // Subsequent run recovers without repeating imports or emitting duplicate outbox intent
    await expect(fixture.processor.run(data)).resolves.toBe("empty");
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.outboxIntents).toHaveLength(1);
    expect(fixture.createForImport).toHaveBeenCalledTimes(2);
});

test("pages remain complete when processed filters change and legacy/ignored choices stay untouched", async () => {
    const fixture = recoveryFixture(255);
    fixture.notified.set(1, {
        gameExternalGameId: 1,
        autoImportRetryable: false,
    });
    fixture.ignored.add(2);
    fixture.processed.add(3);
    await expect(fixture.processor.run(data)).resolves.toBe("complete");
    expect(fixture.createForImport).toHaveBeenCalledTimes(252);
    expect(fixture.notified.get(1).autoImportRetryable).toBe(false);
    expect(fixture.processed.has(1)).toBe(false);
    expect(fixture.ignored.has(2)).toBe(true);
    expect(fixture.notifications).toHaveLength(3);
    expect(fixture.importer.findUnprocessedCandidates).toHaveBeenCalledTimes(1);
    expect(
        fixture.notifications.reduce(
            (total, row) => total + row.autoImportedCount,
            0,
        ),
    ).toBe(252);
});

test("1,001 candidates use one full-list scan and bounded pages while new user choices are rechecked", async () => {
    const fixture = recoveryFixture(1001);
    const processedRead = jest.fn().mockResolvedValue([]);
    const ignoredRead = jest.fn().mockResolvedValue([]);
    const games = Array.from({ length: 1001 }, (_, index) => ({
        id: index + 1,
        gameId: index + 1,
        uid: String(index + 1),
    })).reverse();
    const mappingRead = jest
        .fn()
        .mockResolvedValue([
            ...games,
            { id: 2001, gameId: 1001, uid: "edition" },
        ]);
    const importer = new ImporterService(
        { findBy: processedRead } as any,
        { findBy: ignoredRead } as any,
        {} as any,
        {
            findOneByUserIdAndTypeOrFail: async () => ({
                sourceUserId: "account",
            }),
        } as any,
        {
            getLibraryGames: async () =>
                games.map((game) => ({
                    game: { id: game.id },
                })),
        } as any,
        { getExternalGamesForSourceIds: mappingRead } as any,
        {} as any,
        {} as any,
        {} as any,
        new ConnectionProviderRegistry(),
        {} as any,
        {} as any,
    );
    importer.isProcessedOrIgnored = fixture.importer.isProcessedOrIgnored;
    importer.markProcessed = fixture.importer.markProcessed;
    importer.lockLibrary = fixture.importer.lockLibrary;
    Object.assign(fixture.processor, { importerService: importer });
    const pages = jest.spyOn(fixture.processor as any, "commitPage");
    fixture.createForImport.mockImplementationOnce(async () => {
        fixture.ignored.add(501);
        fixture.processed.add(502);
        return "imported";
    });

    await expect(fixture.processor.run(data)).resolves.toBe("complete");
    expect(processedRead).toHaveBeenCalledTimes(1);
    expect(ignoredRead).toHaveBeenCalledTimes(1);
    expect(mappingRead).toHaveBeenCalledTimes(1);
    const committedPages = pages.mock.calls.map(
        ([, page]) => page as { gameId: number }[],
    );
    expect(committedPages.map((page) => page.length)).toEqual([
        ...Array(10).fill(100),
        1,
    ]);
    expect(
        committedPages.flatMap((page) => page.map((game) => game.gameId)),
    ).toEqual(Array.from({ length: 1001 }, (_, index) => index + 1));
    expect(fixture.createForImport).toHaveBeenCalledTimes(999);
    expect(fixture.processed.has(501)).toBe(false);
    expect(
        fixture.notifications.reduce(
            (sum, row) => sum + row.autoImportSkippedCount,
            0,
        ),
    ).toBe(2);
});

test("commitPage appends discovery outbox intent with result identity and counts", async () => {
    const fixture = recoveryFixture(3);
    await fixture.processor.run(data);
    expect(fixture.outboxIntents).toHaveLength(1);
    const intent = fixture.outboxIntents[0];
    expect(intent.eventType).toBe("import.discovery-completed");
    expect(intent.recipientUserId).toBe(data.userId);
    const payload = intent.payload as any;
    expect(payload.discoveryResultId).toBe(1);
    expect(payload.provider).toBe("steam");
    expect(payload.gameCount).toBe(3);
    expect(payload.importedCount).toBe(3);
    expect(payload.gameSample).toHaveLength(3);
});
