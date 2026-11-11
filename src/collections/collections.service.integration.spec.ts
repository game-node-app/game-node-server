import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { HttpException, HttpStatus } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
    addTransactionalDataSource,
    deleteDataSourceByName,
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { CollectionEntry } from "./collections-entries/entities/collection-entry.entity";
import { CollectionEntryStatus } from "./collections-entries/collections-entries.constants";
import { CollectionEntryToCollection } from "./collections-entries/entities/collection-entry-to-collection.entity";
import { CollectionsEntriesService } from "./collections-entries/collections-entries.service";
import { CollectionsService } from "./collections.service";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { Collection } from "./entities/collection.entity";

describe("CollectionsService limit (MySQL)", () => {
    let dataSource: DataSource;
    let service: CollectionsService;
    let entriesService: CollectionsEntriesService;
    let isSupporter: jest.Mock;

    const createDto: CreateCollectionDto = { name: "Limit test" };

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        addTransactionalDataSource(dataSource);

        isSupporter = jest.fn(async () => false);
        service = new CollectionsService(dataSource.getRepository(Collection), {
            isSupporter,
        } as any);
        entriesService = new CollectionsEntriesService(
            dataSource.getRepository(CollectionEntry),
            dataSource.getRepository(CollectionEntryToCollection),
            { register: jest.fn() } as any,
            { addTrackingJob: jest.fn() } as any,
            { registerLevelExpIncreaseActivity: jest.fn() } as any,
            service,
            {} as any,
            {} as any,
        );

        await dataSource.query(
            "INSERT IGNORE INTO game_platform (id, name) VALUES (1, 'Test platform')",
        );
    });

    afterAll(async () => {
        deleteDataSourceByName("default");
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    beforeEach(() => {
        isSupporter.mockReset().mockResolvedValue(false);
    });

    async function createLibrary(userId: string) {
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            userId,
        ]);
    }

    async function createCollections(userId: string, count: number) {
        const ids: string[] = [];
        for (let index = 0; index < count; index++) {
            const id = randomUUID();
            ids.push(id);
            await dataSource.query(
                "INSERT INTO collection (id, libraryUserId, name, isPublic) VALUES (?, ?, ?, 1)",
                [id, userId, `Collection ${index}`],
            );
        }
        return ids;
    }

    function collectionCount(userId: string) {
        return dataSource
            .getRepository(Collection)
            .count({ where: { libraryUserId: userId } });
    }

    it("creates exactly one collection for two parallel requests at the free boundary", async () => {
        const userId = randomUUID();
        await createLibrary(userId);
        await createCollections(userId, 4);

        const results = await Promise.allSettled([
            service.create(userId, createDto),
            service.create(userId, createDto),
        ]);

        expect(
            results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        const rejected = results.find(
            (result) => result.status === "rejected",
        ) as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(HttpException);
        expect(rejected.reason.getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(rejected.reason.getResponse()).toEqual({
            message: "Collection limit reached.",
            code: "collection_limit_reached",
            limit: 5,
        });
        expect(await collectionCount(userId)).toBe(5);
    });

    it("propagates an entitlement failure at the limit without creating a collection", async () => {
        const userId = randomUUID();
        await createLibrary(userId);
        await createCollections(userId, 5);
        isSupporter.mockRejectedValue(new Error("billing unavailable"));

        await expect(service.create(userId, createDto)).rejects.toThrow(
            "billing unavailable",
        );
        expect(await collectionCount(userId)).toBe(5);
    });

    it("keeps an above-limit library readable, editable and able to add games, then creates again below the limit", async () => {
        const userId = randomUUID();
        await createLibrary(userId);
        const ids = await createCollections(userId, 6);

        const owned = await service.findAllByUserIdWithPermissions(
            userId,
            userId,
        );
        expect(owned).toHaveLength(6);
        expect(
            await service.findOneByIdWithPermissions(userId, ids[0]),
        ).toBeDefined();

        const updated = await service.update(userId, ids[0], {
            name: "Renamed",
        });
        expect(updated.name).toBe("Renamed");

        await entriesService.createOrUpdate(userId, {
            collectionIds: [ids[0]],
            gameId: 1,
            platformIds: [1],
            status: CollectionEntryStatus.PLANNED,
        });
        expect(
            await dataSource
                .getRepository(CollectionEntryToCollection)
                .count({ where: { collectionId: ids[0] } }),
        ).toBe(1);

        const rejected = await service
            .create(userId, createDto)
            .catch((error) => error);
        expect(rejected).toBeInstanceOf(HttpException);
        expect(rejected.getStatus()).toBe(HttpStatus.FORBIDDEN);

        await service.delete(userId, ids[1]);
        await service.delete(userId, ids[2]);
        expect(await collectionCount(userId)).toBe(4);

        await service.create(userId, createDto);
        expect(await collectionCount(userId)).toBe(5);
    });
});
