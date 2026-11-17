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
import { LibraryAccessService } from "../libraries/library-access.service";
import { LibrariesService } from "../libraries/libraries.service";
import { Profile } from "../profile/entities/profile.entity";
import { UserFollow } from "../follow/entity/user-follow.entity";
import { Library } from "../libraries/entities/library.entity";
import { LibraryVisibility } from "../libraries/library-visibility.constants";

describe("CollectionsService limit (MySQL)", () => {
    let dataSource: DataSource;
    let service: CollectionsService;
    let entriesService: CollectionsEntriesService;
    let librariesService: LibrariesService;
    let isSupporter: jest.Mock;
    let libraryAccess: LibraryAccessService;
    const profileIds: string[] = [];

    const createDto: CreateCollectionDto = { name: "Limit test" };

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        addTransactionalDataSource(dataSource);

        isSupporter = jest.fn(async () => false);
        libraryAccess = new LibraryAccessService(
            dataSource.getRepository(Profile),
            dataSource.getRepository(UserFollow),
            dataSource.getRepository(CollectionEntry),
        );
        service = new CollectionsService(
            dataSource.getRepository(Collection),
            { isSupporter } as any,
            undefined,
            libraryAccess,
        );
        librariesService = new LibrariesService(
            dataSource.getRepository(Library),
            libraryAccess,
        );
        entriesService = new CollectionsEntriesService(
            dataSource.getRepository(CollectionEntry),
            dataSource.getRepository(CollectionEntryToCollection),
            { register: jest.fn() } as any,
            { addTrackingJob: jest.fn() } as any,
            { registerLevelExpIncreaseActivity: jest.fn() } as any,
            service,
            {} as any,
            {} as any,
            undefined,
            libraryAccess,
        );

        await dataSource.query(
            "INSERT IGNORE INTO game_platform (id, name) VALUES (1, 'Test platform')",
        );
    });

    afterAll(async () => {
        deleteDataSourceByName("default");
        if (dataSource?.isInitialized) {
            if (profileIds.length) {
                await dataSource.query(
                    `DELETE FROM \`library\` WHERE \`userId\` IN (${profileIds.map(() => "?").join(", ")})`,
                    profileIds,
                );
                await dataSource.query(
                    `DELETE FROM \`profile\` WHERE \`userId\` IN (${profileIds.map(() => "?").join(", ")})`,
                    profileIds,
                );
            }
            await dataSource.destroy();
        }
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

    async function createProfile(
        libraryVisibility: LibraryVisibility = LibraryVisibility.Public,
    ) {
        const userId = randomUUID();
        profileIds.push(userId);
        await dataSource.query(
            "INSERT INTO `profile` (`userId`, `username`, `libraryVisibility`) VALUES (?, ?, ?)",
            [userId, `col_${userId.slice(0, 12)}`, libraryVisibility],
        );
        return userId;
    }

    async function createPrivateCollection(userId: string) {
        const id = randomUUID();
        await dataSource.query(
            "INSERT INTO `collection` (`id`, `libraryUserId`, `name`, `isPublic`) VALUES (?, ?, 'Private', 0)",
            [id, userId],
        );
        return id;
    }

    async function createEntry(
        userId: string,
        gameId: number,
        visibility: LibraryVisibility,
        collectionId?: string,
    ) {
        const id = randomUUID();
        await dataSource.query(
            "INSERT INTO `collection_entry` (`id`, `libraryUserId`, `gameId`, `visibility`) VALUES (?, ?, ?, ?)",
            [id, userId, gameId, visibility],
        );
        if (collectionId) {
            await dataSource.query(
                "INSERT INTO `collection_entry_collections_collection` (`collectionEntryId`, `collectionId`) VALUES (?, ?)",
                [id, collectionId],
            );
        }
        return id;
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

    describe("library ceiling", () => {
        it("hides a public collection whose library is private from non-owners", async () => {
            const ownerId = await createProfile(LibraryVisibility.Private);
            await createLibrary(ownerId);
            const [collectionId] = await createCollections(ownerId, 1);

            await expect(
                service.findOneByIdWithPermissions(undefined, collectionId),
            ).rejects.toMatchObject({ status: 404 });
            expect(
                await service.findAllByUserIdWithPermissions(
                    undefined,
                    ownerId,
                ),
            ).toEqual([]);

            await expect(
                service.findOneByIdWithPermissions(ownerId, collectionId),
            ).resolves.toMatchObject({ id: collectionId });
            expect(
                await service.findAllByUserIdWithPermissions(ownerId, ownerId),
            ).toHaveLength(1);
        });

        it("hides a private collection whatever the library level", async () => {
            const ownerId = await createProfile(LibraryVisibility.Public);
            await createLibrary(ownerId);
            const collectionId = await createPrivateCollection(ownerId);

            await expect(
                service.findOneByIdWithPermissions(undefined, collectionId),
            ).rejects.toMatchObject({ status: 404 });
            expect(
                await service.findAllByUserIdWithPermissions(
                    randomUUID(),
                    ownerId,
                ),
            ).toEqual([]);
            await expect(
                service.findOneByIdWithPermissions(ownerId, collectionId),
            ).resolves.toMatchObject({ id: collectionId });
        });

        it("lists only the entries a visitor may see inside a visible collection", async () => {
            const ownerId = await createProfile(LibraryVisibility.Public);
            await createLibrary(ownerId);
            const [collectionId] = await createCollections(ownerId, 1);
            const publicEntryId = await createEntry(
                ownerId,
                1,
                LibraryVisibility.Public,
                collectionId,
            );
            const privateEntryId = await createEntry(
                ownerId,
                1,
                LibraryVisibility.Private,
                collectionId,
            );

            const [visibleEntries, visibleTotal] =
                await entriesService.findAllByCollectionIdWithPermissions(
                    randomUUID(),
                    collectionId,
                );
            expect(visibleEntries.map((entry) => entry.id)).toEqual([
                publicEntryId,
            ]);
            expect(visibleTotal).toBe(1);

            const [ownedEntries, ownedTotal] =
                await entriesService.findAllByCollectionIdWithPermissions(
                    ownerId,
                    collectionId,
                );
            expect(ownedEntries.map((entry) => entry.id).sort()).toEqual(
                [publicEntryId, privateEntryId].sort(),
            );
            expect(ownedTotal).toBe(2);
        });

        it("returns a hidden library without its public collections", async () => {
            const ownerId = await createProfile(LibraryVisibility.Private);
            await createLibrary(ownerId);
            const [collectionId] = await createCollections(ownerId, 1);

            const library = await librariesService.findOneByIdWithPermissions(
                randomUUID(),
                ownerId,
            );
            expect(library.collections).toEqual([]);

            const ownLibrary = await librariesService.findOneByIdWithPermissions(
                ownerId,
                ownerId,
            );
            expect(ownLibrary.collections.map((collection) => collection.id)).toEqual(
                [collectionId],
            );
        });
    });
});
