import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import {
    addTransactionalDataSource,
    deleteDataSourceByName,
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { CollectionEntryToCollection } from "./entities/collection-entry-to-collection.entity";
import { CollectionsEntriesService } from "./collections-entries.service";
import { CollectionsService } from "../collections.service";
import { Collection } from "../entities/collection.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { UserFollow } from "../../follow/entity/user-follow.entity";
import { UserGameCover } from "../../game/game-cover/entities/user-game-cover.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { LibraryAccessService } from "../../libraries/library-access.service";
import { LibraryVisibility } from "../../libraries/library-visibility.constants";
import { CollectionEntryStatus } from "./collections-entries.constants";

describe("CollectionsEntriesService permissions (MySQL)", () => {
    let source: DataSource;
    let entries: CollectionsEntriesService;

    const owner = randomUUID();
    const follower = randomUUID();
    const viewer = randomUUID();
    const hiddenOwner = randomUUID();
    const relatedOwner = randomUUID();
    const userIds = [owner, follower, viewer, hiddenOwner, relatedOwner];

    const entryIds = {
        noCollection: randomUUID(),
        privateCollection: randomUUID(),
        followers: randomUUID(),
        private: randomUUID(),
        hiddenLibrary: randomUUID(),
        relatedParent: randomUUID(),
        relatedDlc: randomUUID(),
        relatedExpansion: randomUUID(),
    };
    const privateCollectionId = randomUUID();

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        addTransactionalDataSource(source);

        await source.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (2, 'Two', 'two'), (3, 'Three', 'three'), (4, 'Four', 'four')",
        );
        for (const [index, userId] of userIds.entries()) {
            await source.query(
                "INSERT INTO `profile` (`userId`, `username`, `libraryVisibility`) VALUES (?, ?, ?)",
                [
                    userId,
                    `ce${index}${randomUUID().slice(0, 8)}`,
                    userId === hiddenOwner
                        ? LibraryVisibility.Private
                        : LibraryVisibility.Public,
                ],
            );
            await source.query("INSERT INTO `library` (`userId`) VALUES (?)", [
                userId,
            ]);
        }
        await source.query(
            "INSERT INTO `user_follow` (`followerUserId`, `followedUserId`) VALUES (?, ?), (?, ?)",
            [follower, owner, follower, relatedOwner],
        );

        const insertEntry = (
            id: string,
            libraryUserId: string,
            gameId: number,
            visibility: LibraryVisibility,
            extra: {
                status?: CollectionEntryStatus;
                isFavorite?: boolean;
            } = {},
        ) =>
            source.query(
                "INSERT INTO `collection_entry` (`id`, `libraryUserId`, `gameId`, `visibility`, `status`, `isFavorite`) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    id,
                    libraryUserId,
                    gameId,
                    visibility,
                    extra.status ?? CollectionEntryStatus.PLANNED,
                    extra.isFavorite ?? false,
                ],
            );

        await insertEntry(
            entryIds.noCollection,
            owner,
            1,
            LibraryVisibility.Public,
        );
        await insertEntry(
            entryIds.privateCollection,
            owner,
            2,
            LibraryVisibility.Public,
            { isFavorite: true },
        );
        await insertEntry(
            entryIds.followers,
            owner,
            3,
            LibraryVisibility.Followers,
            { status: CollectionEntryStatus.FINISHED },
        );
        await insertEntry(
            entryIds.private,
            owner,
            4,
            LibraryVisibility.Private,
        );
        await insertEntry(
            entryIds.hiddenLibrary,
            hiddenOwner,
            1,
            LibraryVisibility.Public,
        );
        await insertEntry(
            entryIds.relatedParent,
            relatedOwner,
            1,
            LibraryVisibility.Public,
        );
        await insertEntry(
            entryIds.relatedDlc,
            relatedOwner,
            2,
            LibraryVisibility.Private,
        );
        await insertEntry(
            entryIds.relatedExpansion,
            relatedOwner,
            3,
            LibraryVisibility.Public,
        );

        await source.query(
            "INSERT INTO `collection` (`id`, `libraryUserId`, `name`, `isPublic`) VALUES (?, ?, 'Private', 0)",
            [privateCollectionId, owner],
        );
        await source.query(
            "INSERT INTO `collection_entry_collections_collection` (`collectionEntryId`, `collectionId`) VALUES (?, ?)",
            [entryIds.privateCollection, privateCollectionId],
        );

        const libraryAccess = new LibraryAccessService(
            source.getRepository(Profile),
            source.getRepository(UserFollow),
            source.getRepository(CollectionEntry),
        );
        const collections = new CollectionsService(
            source.getRepository(Collection),
            { isSupporter: jest.fn(async () => false) } as any,
            undefined,
            libraryAccess,
        );
        entries = new CollectionsEntriesService(
            source.getRepository(CollectionEntry),
            source.getRepository(CollectionEntryToCollection),
            { register: jest.fn() } as any,
            { addTrackingJob: jest.fn() } as any,
            { registerLevelExpIncreaseActivity: jest.fn() } as any,
            collections,
            {
                findOneByIdOrFail: (id: number, dto?: any) =>
                    source.getRepository(Game).findOneOrFail({
                        where: { id },
                        relations: dto?.relations,
                    }),
            } as any,
            source.getRepository(UserGameCover),
            undefined,
            libraryAccess,
        );

        // The join tables persist across runs, so replace instead of only adding.
        await source
            .createQueryBuilder()
            .relation(Game, "dlcs")
            .of(1)
            .remove(2);
        await source.createQueryBuilder().relation(Game, "dlcs").of(1).add(2);
        await source
            .createQueryBuilder()
            .relation(Game, "expansions")
            .of(1)
            .remove(3);
        await source
            .createQueryBuilder()
            .relation(Game, "expansions")
            .of(1)
            .add(3);
    }, 120000);

    afterAll(async () => {
        deleteDataSourceByName("default");
        if (source?.isInitialized) {
            await source.query(
                `DELETE FROM \`user_follow\` WHERE \`followerUserId\` IN (${userIds.map(() => "?").join(", ")}) OR \`followedUserId\` IN (${userIds.map(() => "?").join(", ")})`,
                [...userIds, ...userIds],
            );
            await source.query(
                `DELETE FROM \`library\` WHERE \`userId\` IN (${userIds.map(() => "?").join(", ")})`,
                userIds,
            );
            await source.query(
                `DELETE FROM \`profile\` WHERE \`userId\` IN (${userIds.map(() => "?").join(", ")})`,
                userIds,
            );
            await source.destroy();
        }
    });

    function ids(collectionEntries: CollectionEntry[]) {
        return collectionEntries.map((entry) => entry.id).sort();
    }

    it("lists only the levels the viewer may see, ignoring collection privacy", async () => {
        const [anonymousEntries, anonymousTotal] =
            await entries.findAllByUserIdWithPermissions(undefined, owner, {});
        expect(ids(anonymousEntries)).toEqual(
            [entryIds.noCollection, entryIds.privateCollection].sort(),
        );
        expect(anonymousTotal).toBe(2);
        expect(
            anonymousEntries.find(
                (entry) => entry.id === entryIds.privateCollection,
            )!.collections,
        ).toEqual([]);

        const [followerEntries, followerTotal] =
            await entries.findAllByUserIdWithPermissions(follower, owner, {});
        expect(ids(followerEntries)).toEqual(
            [
                entryIds.noCollection,
                entryIds.privateCollection,
                entryIds.followers,
            ].sort(),
        );
        expect(followerTotal).toBe(3);
    });

    it("shows every entry and collection to the owner", async () => {
        const [ownedEntries, total] =
            await entries.findAllByUserIdWithPermissions(owner, owner, {});

        expect(total).toBe(4);
        expect(
            ownedEntries
                .find((entry) => entry.id === entryIds.privateCollection)!
                .collections.map((collection) => collection.id),
        ).toEqual([privateCollectionId]);
    });

    it("returns an empty page for a hidden library", async () => {
        await expect(
            entries.findAllByUserIdWithPermissions(viewer, hiddenOwner, {}),
        ).resolves.toEqual([[], 0]);
    });

    it("keeps status totals over the visible entries", async () => {
        const [finishedEntries, finishedTotal] =
            await entries.findAllByUserIdWithPermissions(follower, owner, {
                status: CollectionEntryStatus.FINISHED,
            });
        expect(ids(finishedEntries)).toEqual([entryIds.followers]);
        expect(finishedTotal).toBe(1);
    });

    it("keeps custom cover totals over the visible entries", async () => {
        await source.query(
            "INSERT IGNORE INTO `game_cover_option` (`gameId`, `kind`, `origin`, `igdbId`, `label`) VALUES (1, 'alternative', 'cover', 999999, 'fixture')",
        );
        const [{ id: coverOptionId }] = await source.query(
            "SELECT `id` FROM `game_cover_option` WHERE `origin` = 'cover' AND `igdbId` = 999999",
        );
        await source.query(
            "INSERT IGNORE INTO `user_game_cover` (`userId`, `gameId`, `coverOptionId`) VALUES (?, 1, ?), (?, 3, ?)",
            [owner, coverOptionId, owner, coverOptionId],
        );

        const [anonymousEntries, anonymousTotal] =
            await entries.findAllByUserIdWithPermissions(undefined, owner, {
                hasCustomCover: true,
            });
        expect(ids(anonymousEntries)).toEqual([entryIds.noCollection]);
        expect(anonymousTotal).toBe(1);

        const [ownedEntries, ownedTotal] =
            await entries.findAllByUserIdWithPermissions(owner, owner, {
                hasCustomCover: true,
            });
        expect(ids(ownedEntries)).toEqual(
            [entryIds.noCollection, entryIds.followers].sort(),
        );
        expect(ownedTotal).toBe(2);
    });

    it("applies the same rule to favorites and strips private collections", async () => {
        const [favoriteEntries, favoriteTotal] =
            await entries.findFavoritesByUserId(viewer, owner, {});

        expect(ids(favoriteEntries)).toEqual([entryIds.privateCollection]);
        expect(favoriteTotal).toBe(1);
        expect(favoriteEntries[0].collections).toEqual([]);
    });

    it("returns the same 404 for a hidden entry as for a missing one", async () => {
        const hiddenError = await entries
            .findOneByIdForViewer(undefined, entryIds.followers)
            .catch((thrown) => thrown);
        const missingError = await entries
            .findOneByIdForViewer(undefined, randomUUID())
            .catch((thrown) => thrown);

        expect(hiddenError.getStatus()).toBe(404);
        expect(hiddenError.getResponse()).toEqual(missingError.getResponse());
    });

    it("resolves the by-game read with the viewer", async () => {
        await expect(
            entries.findOneByUserIdAndGameIdForViewer(undefined, owner, 3),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
            entries.findOneByUserIdAndGameIdForViewer(follower, owner, 3),
        ).resolves.toMatchObject({ id: entryIds.followers });
    });

    it("strips private collections from a visible entry for a visitor", async () => {
        const entry = await entries.findOneByIdForViewer(
            undefined,
            entryIds.privateCollection,
        );
        expect(entry.collections).toEqual([]);
    });

    it("applies access to related entries, owned-platform icons and collections", async () => {
        const relatedForVisitor = await entries.findRelatedEntriesForViewer(
            undefined,
            entryIds.relatedParent,
        );
        expect(relatedForVisitor.dlcs).toEqual([]);
        expect(relatedForVisitor.expansions.map((entry) => entry.id)).toEqual([
            entryIds.relatedExpansion,
        ]);

        const relatedForOwner = await entries.findRelatedEntriesForViewer(
            relatedOwner,
            entryIds.relatedParent,
        );
        expect(relatedForOwner.dlcs.map((entry) => entry.id)).toEqual([
            entryIds.relatedDlc,
        ]);

        await expect(
            entries.findIconsForOwnedPlatformsForViewer(
                undefined,
                entryIds.followers,
            ),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
            entries.findIconsForOwnedPlatformsForViewer(
                undefined,
                entryIds.noCollection,
            ),
        ).resolves.toEqual([]);

        const [collectionEntries, collectionTotal] =
            await entries.findAllByCollectionIdWithPermissions(
                undefined,
                privateCollectionId,
            );
        expect([collectionEntries, collectionTotal]).toEqual([[], 0]);
        const [ownedCollectionEntries] =
            await entries.findAllByCollectionIdWithPermissions(
                owner,
                privateCollectionId,
            );
        expect(ownedCollectionEntries.map((entry) => entry.id)).toEqual([
            entryIds.privateCollection,
        ]);
    });
});
