import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { plainToInstance } from "class-transformer";
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
import { CollectionEntryStatusHistory } from "./entities/collection-entry-status-history.entity";
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
import { FindCollectionEntriesDto } from "./dto/find-collection-entries.dto";
import { EGameCategory } from "../../game/game-repository/game-repository.constants";
import { LevelIncreaseActivities } from "../../level/level.constants";

describe("CollectionsEntriesService permissions (MySQL)", () => {
    let source: DataSource;
    let entries: CollectionsEntriesService;
    let levels: { registerLevelExpIncreaseActivity: jest.Mock };

    const owner = randomUUID();
    const follower = randomUUID();
    const viewer = randomUUID();
    const hiddenOwner = randomUUID();
    const relatedOwner = randomUUID();
    const searchOwner = randomUUID();
    const historyOwner = randomUUID();
    const historyRelatedOwner = randomUUID();
    const userIds = [
        owner,
        follower,
        viewer,
        hiddenOwner,
        relatedOwner,
        searchOwner,
        historyOwner,
        historyRelatedOwner,
    ];
    const historyCollectionId = randomUUID();

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

    const searchCollectionId = randomUUID();
    const lateGameId = 900015;
    const searchGames = {
        halo3: { id: 900001, name: "Halo 3" },
        haloInfinite: { id: 900002, name: "Halo Infinite" },
        halo4: { id: 900003, name: "Halo 4" },
        halo2: { id: 900004, name: "Halo 2" },
        minecraft: { id: 900005, name: "Minecraft" },
        zelda: {
            id: 900006,
            name: "The Legend of Zelda: Breath of the Wild",
        },
        twoAliases: { id: 900007, name: "Two Aliases Game" },
        halfLife2: { id: 900008, name: "Half-Life 2" },
        pokemon: { id: 900009, name: "Pokémon: Let's Go, Pikachu!" },
        assassins: { id: 900010, name: "Assassin's Creed" },
        orangeJuice: { id: 900011, name: "100% Orange Juice" },
        orLiteral: { id: 900012, name: "Or 1 1 The Game" },
        dlcBase: { id: 900013, name: "Search DLC Base" },
        dlcAddon: {
            id: 900014,
            name: "Search DLC Addon",
            category: EGameCategory.DlcAddon,
        },
    };
    const searchEntryIds = {
        halo3: randomUUID(),
        haloInfinite: randomUUID(),
        halo4: randomUUID(),
        minecraft: randomUUID(),
        zelda: randomUUID(),
        twoAliases: randomUUID(),
        halfLife2: randomUUID(),
        pokemon: randomUUID(),
        assassins: randomUUID(),
        orangeJuice: randomUUID(),
        orLiteral: randomUUID(),
        dlcBase: randomUUID(),
        dlcAddon: randomUUID(),
    };
    const orderFixtures = Array.from({ length: 25 }, (_, index) => ({
        gameId: 902001 + index,
        entryId: randomUUID(),
        name: `Order Fixture ${String(index + 1).padStart(2, "0")}`,
        createdAt: `2026-02-01 00:00:${String(index).padStart(2, "0")}.000000`,
    }));

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
        await source.query(
            "INSERT IGNORE INTO `game_platform` (`id`, `name`, `abbreviation`) VALUES (6, 'PC', 'PC')",
        );
        await source.query(
            "INSERT INTO `collection` (`id`, `libraryUserId`, `name`, `isPublic`) VALUES (?, ?, 'History', 1)",
            [historyCollectionId, historyOwner],
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

        const gameRows = Object.values(searchGames);
        await source.query(
            `INSERT IGNORE INTO game (id, name, slug, category) VALUES ${gameRows.map(() => "(?, ?, ?, ?)").join(", ")}`,
            gameRows.flatMap((game) => [
                game.id,
                game.name,
                `search-${game.id}`,
                "category" in game ? game.category : EGameCategory.Main,
            ]),
        );
        await source.query(
            `INSERT IGNORE INTO game_alternative_name (id, name, gameId) VALUES ${Array.from({ length: 3 }, () => "(?, ?, ?)").join(", ")}`,
            [
                920001,
                "BOTW",
                searchGames.zelda.id,
                920002,
                "Alpha Beta",
                searchGames.twoAliases.id,
                920003,
                "Gamma Delta",
                searchGames.twoAliases.id,
            ],
        );

        await insertEntry(
            searchEntryIds.halo3,
            searchOwner,
            searchGames.halo3.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.haloInfinite,
            searchOwner,
            searchGames.haloInfinite.id,
            LibraryVisibility.Public,
            { isFavorite: true },
        );
        await insertEntry(
            searchEntryIds.halo4,
            searchOwner,
            searchGames.halo4.id,
            LibraryVisibility.Private,
        );
        await insertEntry(
            searchEntryIds.minecraft,
            searchOwner,
            searchGames.minecraft.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.zelda,
            searchOwner,
            searchGames.zelda.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.twoAliases,
            searchOwner,
            searchGames.twoAliases.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.halfLife2,
            searchOwner,
            searchGames.halfLife2.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.pokemon,
            searchOwner,
            searchGames.pokemon.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.assassins,
            searchOwner,
            searchGames.assassins.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.orangeJuice,
            searchOwner,
            searchGames.orangeJuice.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.orLiteral,
            searchOwner,
            searchGames.orLiteral.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.dlcBase,
            searchOwner,
            searchGames.dlcBase.id,
            LibraryVisibility.Public,
        );
        await insertEntry(
            searchEntryIds.dlcAddon,
            searchOwner,
            searchGames.dlcAddon.id,
            LibraryVisibility.Public,
        );

        await source.query(
            `INSERT IGNORE INTO game (id, name, slug, category) VALUES ${orderFixtures.map(() => "(?, ?, ?, ?)").join(", ")}`,
            orderFixtures.flatMap((game) => [
                game.gameId,
                game.name,
                `search-${game.gameId}`,
                EGameCategory.Main,
            ]),
        );
        await source.query(
            `INSERT INTO collection_entry (id, libraryUserId, gameId, visibility, status, isFavorite, createdAt) VALUES ${orderFixtures.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
            orderFixtures.flatMap((game) => [
                game.entryId,
                searchOwner,
                game.gameId,
                LibraryVisibility.Public,
                CollectionEntryStatus.PLANNED,
                false,
                game.createdAt,
            ]),
        );

        await source.query(
            "INSERT INTO `collection` (`id`, `libraryUserId`, `name`, `isPublic`) VALUES (?, ?, 'Search Halo', 1)",
            [searchCollectionId, searchOwner],
        );
        await source.query(
            "INSERT INTO `collection_entry_collections_collection` (`collectionEntryId`, `collectionId`) VALUES (?, ?)",
            [searchEntryIds.halo3, searchCollectionId],
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
            (levels = { registerLevelExpIncreaseActivity: jest.fn() }) as any,
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

    describe("library search", () => {
        function searchLibrary(
            search: string,
            dto: FindCollectionEntriesDto = {},
            viewerId?: string,
        ) {
            return entries.findAllByUserIdWithPermissions(
                viewerId,
                searchOwner,
                {
                    ...dto,
                    search,
                },
            );
        }

        it("matches title and alternative-name substrings with the original names", async () => {
            const [haloEntries, haloTotal] = await searchLibrary("halo");
            expect(ids(haloEntries)).toEqual(
                [searchEntryIds.halo3, searchEntryIds.haloInfinite].sort(),
            );
            expect(haloTotal).toBe(2);
            expect(
                haloEntries.find((entry) => entry.id === searchEntryIds.halo3)!
                    .game.name,
            ).toBe("Halo 3");

            const [zeldaEntries, zeldaTotal] = await searchLibrary("botw");
            expect(ids(zeldaEntries)).toEqual([searchEntryIds.zelda]);
            expect(zeldaTotal).toBe(1);
        });

        it("matches a partial word", async () => {
            const [found, total] = await searchLibrary("minec");

            expect(ids(found)).toEqual([searchEntryIds.minecraft]);
            expect(total).toBe(1);
        });

        it("does not match across two aliases or out-of-order words", async () => {
            await expect(searchLibrary("beta gamma")).resolves.toEqual([[], 0]);
            await expect(searchLibrary("life half")).resolves.toEqual([[], 0]);

            const [found, total] = await searchLibrary("alpha");
            expect(ids(found)).toEqual([searchEntryIds.twoAliases]);
            expect(total).toBe(1);
        });

        it.each([
            ["Assassin's Creed", searchEntryIds.assassins],
            ["Assassin’s Creed", searchEntryIds.assassins],
            ["assassins creed", searchEntryIds.assassins],
            ["POKEMON LETS GO", searchEntryIds.pokemon],
            ["pokémon", searchEntryIds.pokemon],
            ["Poke\u0301mon", searchEntryIds.pokemon],
            ["half life 2", searchEntryIds.halfLife2],
            ["half-life", searchEntryIds.halfLife2],
        ])("normalizes %p like catalog search", async (search, expectedId) => {
            const [found, total] = await searchLibrary(search);

            expect(ids(found)).toEqual([expectedId]);
            expect(total).toBe(1);
        });

        it("treats wildcard characters as literal text", async () => {
            const [found, total] = await searchLibrary("100%");

            expect(ids(found)).toEqual([searchEntryIds.orangeJuice]);
            expect(total).toBe(1);
        });

        it("treats SQL-like text as literal text", async () => {
            const [found, total] = await searchLibrary("' OR 1=1 --");

            expect(ids(found)).toEqual([searchEntryIds.orLiteral]);
            expect(total).toBe(1);
        });

        it.each(["%%%", "'", "_"])(
            "returns an empty page for %p when normalization leaves nothing",
            async (search) => {
                await expect(searchLibrary(search)).resolves.toEqual([[], 0]);
            },
        );

        it("never returns a catalog game without an entry in the library", async () => {
            await expect(searchLibrary("halo 2")).resolves.toEqual([[], 0]);
        });

        it("finds an entry added after an earlier search", async () => {
            await expect(searchLibrary("late arrival")).resolves.toEqual([
                [],
                0,
            ]);

            await source.query(
                "DELETE FROM `collection_entry` WHERE `gameId` = ?",
                [lateGameId],
            );
            await source.query("DELETE FROM `game` WHERE `id` = ?", [
                lateGameId,
            ]);
            await source.query(
                "INSERT INTO `game` (`id`, `name`, `slug`) VALUES (?, 'Late Arrival', 'late-arrival')",
                [lateGameId],
            );
            const lateEntryId = randomUUID();
            await source.query(
                "INSERT INTO `collection_entry` (`id`, `libraryUserId`, `gameId`, `visibility`, `status`, `isFavorite`) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    lateEntryId,
                    searchOwner,
                    lateGameId,
                    LibraryVisibility.Public,
                    CollectionEntryStatus.PLANNED,
                    false,
                ],
            );

            const [found, total] = await searchLibrary("late arrival");
            expect(ids(found)).toEqual([lateEntryId]);
            expect(total).toBe(1);
        });

        it("does not return or count a private entry for an anonymous viewer", async () => {
            const [anonymousEntries, anonymousTotal] =
                await searchLibrary("halo");
            expect(ids(anonymousEntries)).not.toContain(searchEntryIds.halo4);
            expect(anonymousTotal).toBe(2);

            const [, ownerTotal] = await searchLibrary("halo", {}, searchOwner);
            expect(ownerTotal).toBe(3);
        });

        it("returns an empty page for a hidden library", async () => {
            await expect(
                entries.findAllByUserIdWithPermissions(viewer, hiddenOwner, {
                    search: "notification",
                }),
            ).resolves.toEqual([[], 0]);
        });

        it("keeps the default category filter and honors an explicit one", async () => {
            const dto = plainToInstance(FindCollectionEntriesDto, {
                search: "search dlc",
            });
            const [baseEntries, baseTotal] =
                await entries.findAllByUserIdWithPermissions(
                    undefined,
                    searchOwner,
                    dto,
                );
            expect(ids(baseEntries)).toEqual([searchEntryIds.dlcBase]);
            expect(baseTotal).toBe(1);

            const [dlcEntries, dlcTotal] = await searchLibrary("search dlc", {
                gameFilters: { category: [EGameCategory.DlcAddon] },
            });
            expect(ids(dlcEntries)).toEqual([searchEntryIds.dlcAddon]);
            expect(dlcTotal).toBe(1);
        });

        it("narrows the favorites listing", async () => {
            const [found, total] = await entries.findFavoritesByUserId(
                undefined,
                searchOwner,
                { search: "halo" },
            );

            expect(ids(found)).toEqual([searchEntryIds.haloInfinite]);
            expect(total).toBe(1);
        });

        it("narrows the collection listing", async () => {
            const [found, total] =
                await entries.findAllByCollectionIdWithPermissions(
                    undefined,
                    searchCollectionId,
                    { search: "halo" },
                );
            expect(ids(found)).toEqual([searchEntryIds.halo3]);
            expect(total).toBe(1);

            await expect(
                entries.findAllByCollectionIdWithPermissions(
                    undefined,
                    searchCollectionId,
                    { search: "half" },
                ),
            ).resolves.toEqual([[], 0]);
        });

        it("keeps ordering, pagination and filtered totals", async () => {
            const [found, total] = await searchLibrary("order fixture", {
                orderBy: { addedDate: "DESC" },
                offset: 20,
                limit: 20,
            });

            expect(total).toBe(25);
            expect(found.map((entry) => entry.id)).toEqual(
                [4, 3, 2, 1, 0].map((index) => orderFixtures[index].entryId),
            );
        });

        it("keeps the unfiltered listing for a blank search", async () => {
            const [plainEntries, plainTotal] =
                await entries.findAllByUserIdWithPermissions(
                    searchOwner,
                    searchOwner,
                    {},
                );
            const [blankEntries, blankTotal] = await searchLibrary(
                "   ",
                {},
                searchOwner,
            );

            expect(ids(blankEntries)).toEqual(ids(plainEntries));
            expect(blankTotal).toBe(plainTotal);
        });
    });

    describe("library status history", () => {
        const historyRows = (userId: string, gameId: number) =>
            source.getRepository(CollectionEntryStatusHistory).find({
                where: { libraryUserId: userId, gameId },
                order: { id: "ASC" },
            });
        const entryFor = (userId: string, gameId: number) =>
            source
                .getRepository(CollectionEntry)
                .findOneByOrFail({ libraryUserId: userId, gameId });
        const dto = (extra: Record<string, unknown> = {}) => ({
            gameId: 1,
            status: CollectionEntryStatus.FINISHED,
            collectionIds: [historyCollectionId],
            platformIds: [6],
            ...extra,
        });
        const gameFinishedCalls = () =>
            levels.registerLevelExpIncreaseActivity.mock.calls.filter(
                ([, activity]) =>
                    activity === LevelIncreaseActivities.GAME_FINISHED,
            );

        it("appends one row per change and grants XP only on the first finish", async () => {
            levels.registerLevelExpIncreaseActivity.mockClear();

            await entries.createOrUpdate(historyOwner, dto());
            await entries.createOrUpdate(
                historyOwner,
                dto({ status: CollectionEntryStatus.PLANNED }),
            );
            await entries.createOrUpdate(historyOwner, dto());
            // Re-saving without a status change must not append.
            await entries.createOrUpdate(historyOwner, dto());

            const rows = await historyRows(historyOwner, 1);
            expect(
                rows.map((row) => [row.fromStatus, row.toStatus, row.source]),
            ).toEqual([
                [null, CollectionEntryStatus.FINISHED, "manual"],
                [
                    CollectionEntryStatus.FINISHED,
                    CollectionEntryStatus.PLANNED,
                    "manual",
                ],
                [
                    CollectionEntryStatus.PLANNED,
                    CollectionEntryStatus.FINISHED,
                    "manual",
                ],
            ]);
            expect(rows.every((row) => row.occurredAt instanceof Date)).toBe(
                true,
            );
            expect(gameFinishedCalls()).toHaveLength(1);
        });

        it("keeps history and the first finish after deleting and re-adding", async () => {
            const first = await entryFor(historyOwner, 1);
            await entries.delete(historyOwner, first.id);

            const afterDelete = await historyRows(historyOwner, 1);
            expect(afterDelete).toHaveLength(3);
            expect(afterDelete.map((row) => row.collectionEntryId)).toEqual([
                null,
                null,
                null,
            ]);
            const firstFinishId = afterDelete[0].id;

            levels.registerLevelExpIncreaseActivity.mockClear();
            await entries.createOrUpdate(historyOwner, dto());

            const afterReAdd = await historyRows(historyOwner, 1);
            expect(afterReAdd).toHaveLength(4);
            expect(afterReAdd[3]).toMatchObject({
                fromStatus: null,
                toStatus: CollectionEntryStatus.FINISHED,
                source: "manual",
            });
            expect(afterReAdd[0].id).toBe(firstFinishId);
            expect(gameFinishedCalls()).toHaveLength(0);
        });

        it("keeps the stored status dates when the status does not change", async () => {
            await entries.createOrUpdate(
                historyOwner,
                dto({ gameId: 2, status: CollectionEntryStatus.PLANNED }),
            );
            const plannedAt = new Date("2023-01-02T03:04:05Z");
            await source
                .getRepository(CollectionEntry)
                .update(
                    { libraryUserId: historyOwner, gameId: 2 },
                    { plannedAt },
                );

            await entries.createOrUpdate(
                historyOwner,
                dto({ gameId: 2, status: CollectionEntryStatus.PLANNED }),
            );

            const entry = await entryFor(historyOwner, 2);
            expect(entry.plannedAt?.getTime()).toBe(plannedAt.getTime());
            expect(await historyRows(historyOwner, 2)).toHaveLength(1);
        });

        it("keeps finishedAt unless the client supplies one", async () => {
            const stored = new Date("2024-05-06T07:08:09Z");
            await entries.createOrUpdate(
                historyOwner,
                dto({ gameId: 3, finishedAt: stored }),
            );
            await entries.createOrUpdate(historyOwner, dto({ gameId: 3 }));

            let entry = await entryFor(historyOwner, 3);
            expect(entry.finishedAt?.getTime()).toBe(stored.getTime());

            const supplied = new Date("2025-01-01T00:00:00Z");
            await entries.createOrUpdate(
                historyOwner,
                dto({ gameId: 3, finishedAt: supplied }),
            );

            entry = await entryFor(historyOwner, 3);
            expect(entry.finishedAt?.getTime()).toBe(supplied.getTime());
            expect(await historyRows(historyOwner, 3)).toHaveLength(1);
        });

        it("records import and related origins", async () => {
            await expect(
                entries.createForImport(historyRelatedOwner, 4, 6),
            ).resolves.toBe("imported");
            const imported = await historyRows(historyRelatedOwner, 4);
            expect(
                imported.map((row) => [
                    row.fromStatus,
                    row.toStatus,
                    row.source,
                ]),
            ).toEqual([[null, CollectionEntryStatus.PLANNED, "import"]]);

            await entries.createOrUpdate(
                historyRelatedOwner,
                dto({ gameId: 1, collectionIds: [], relatedGameIds: [2] }),
            );
            const related = await historyRows(historyRelatedOwner, 2);
            expect(
                related.map((row) => [
                    row.fromStatus,
                    row.toStatus,
                    row.source,
                ]),
            ).toEqual([[null, CollectionEntryStatus.FINISHED, "related"]]);
        });
    });
});
