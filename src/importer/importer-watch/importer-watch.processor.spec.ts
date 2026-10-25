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

it("a complete empty discovery completes the worker without treating other 404s as success", async () => {
    const importer: ImporterService = Object.assign(
        Object.create(ImporterService.prototype),
        {
            findUnprocessedSteamEntries: jest.fn().mockResolvedValue([]),
        },
    );
    const save = jest.fn();
    const processor = new ImporterWatchProcessor(
        { save } as any,
        { save, find: jest.fn().mockResolvedValue([]) } as any,
        importer,
        {} as any,
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
    jest.spyOn(importer, "findUnprocessedEntries").mockRejectedValue(
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
    const notificationRepository = {
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
    const importer = {
        findUnprocessedEntries: jest.fn(
            async (_user, _source, dto, afterGameId = 0) => {
                const remaining = games.filter(
                    (game) =>
                        game.gameId > afterGameId &&
                        !processed.has(game.id) &&
                        !ignored.has(game.id),
                );
                return [remaining.slice(0, dto.limit), remaining.length];
            },
        ),
        isProcessedOrIgnored: jest.fn(
            async (_user, id) => processed.has(id) || ignored.has(id),
        ),
        markProcessed: jest.fn(async (_user, id) => {
            processed.add(id);
        }),
    };
    const createForImport = jest.fn().mockResolvedValue("imported");
    const registerImporterNotification = jest.fn().mockResolvedValue({});
    const processor = new ImporterWatchProcessor(
        {
            findBy: jest.fn(async () => [...notified.values()]),
            upsert: jest.fn(async (row) => {
                notified.set(row.gameExternalGameId, row);
            }),
        } as any,
        notificationRepository as any,
        importer as any,
        { registerImporterNotification } as any,
        {
            findOneByUserIdAndType: jest
                .fn()
                .mockResolvedValue({
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
        notificationRepository,
        importer,
        createForImport,
        registerImporterNotification,
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
        pendingDelivery: false,
    });
    await expect(fixture.processor.run(data)).resolves.toBe("complete");
    expect(fixture.processed).toEqual(new Set([1, 2]));
    expect(fixture.createForImport).toHaveBeenCalledTimes(3);
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.registerImporterNotification).toHaveBeenCalledTimes(1);
});

test("publication failure recovers the committed source record without repeating imports", async () => {
    const fixture = recoveryFixture();
    fixture.registerImporterNotification.mockRejectedValueOnce(
        new Error("Redis unavailable"),
    );
    await expect(fixture.processor.run(data)).rejects.toThrow(
        "Redis unavailable",
    );
    expect(fixture.notifications[0].pendingDelivery).toBe(true);
    await expect(fixture.processor.run(data)).resolves.toBe("empty");
    expect(fixture.notifications[0].pendingDelivery).toBe(false);
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.createForImport).toHaveBeenCalledTimes(2);
    expect(
        fixture.registerImporterNotification.mock.calls.map(
            ([dto]) => dto.sourceId,
        ),
    ).toEqual([1, 1]);
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
    expect(
        fixture.importer.findUnprocessedEntries.mock.calls.every(
            ([, , dto]) => dto.limit === 100,
        ),
    ).toBe(true);
    expect(
        fixture.notifications.reduce(
            (total, row) => total + row.autoImportedCount,
            0,
        ),
    ).toBe(252);
});
