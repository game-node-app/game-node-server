import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryToCollection } from "../../collections/collections-entries/entities/collection-entry-to-collection.entity";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { CollectionsService } from "../../collections/collections.service";
import { Collection } from "../../collections/entities/collection.entity";
import { PlaytimeService } from "../../playtime/playtime.service";
import { UserPlaytime } from "../../playtime/entity/user-playtime.entity";
import { Profile } from "../entities/profile.entity";
import { UserFollow } from "../../follow/entity/user-follow.entity";
import { LibraryAccessService } from "../../libraries/library-access.service";
import { LibraryVisibility } from "../../libraries/library-visibility.constants";
import { ProfileMetricsService } from "./profile-metrics.service";

const PUBLIC_GAME = 940001;
const FINISHED_GAME = 940002;
const PRIVATE_GAME = 940003;
const PLAYTIME_ONLY_GAME = 940004;
const PRIVATE_LIBRARY_GAME = 940005;
const PLATFORM = 940100;

jest.setTimeout(120_000);

describe("ProfileMetricsService overview access (MySQL)", () => {
    let source: DataSource;
    let metrics: ProfileMetricsService;
    let ownerId: string;
    let privateOwnerId: string;

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        const libraryAccess = new LibraryAccessService(
            source.getRepository(Profile),
            source.getRepository(UserFollow),
            source.getRepository(CollectionEntry),
        );
        const collections = new CollectionsService(
            source.getRepository(Collection),
            {} as any,
            undefined,
            libraryAccess,
        );
        const entries = new CollectionsEntriesService(
            source.getRepository(CollectionEntry),
            source.getRepository(CollectionEntryToCollection),
            {} as any,
            {} as any,
            {} as any,
            collections,
            {} as any,
            {} as any,
            undefined,
            libraryAccess,
        );
        metrics = new ProfileMetricsService(
            collections,
            entries,
            new PlaytimeService(source.getRepository(UserPlaytime), {} as any),
            libraryAccess,
        );

        ownerId = randomUUID();
        privateOwnerId = randomUUID();
        await source.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)",
            [
                PUBLIC_GAME,
                "Metrics public",
                "metrics-public-fixture",
                FINISHED_GAME,
                "Metrics finished",
                "metrics-finished-fixture",
                PRIVATE_GAME,
                "Metrics private",
                "metrics-private-fixture",
                PLAYTIME_ONLY_GAME,
                "Metrics playtime",
                "metrics-playtime-fixture",
                PRIVATE_LIBRARY_GAME,
                "Metrics hidden library",
                "metrics-hidden-library-fixture",
            ],
        );
        await source.query(
            "INSERT IGNORE INTO game_platform (id, name) VALUES (?, ?)",
            [PLATFORM, "Metrics platform"],
        );
        await source.query(
            "INSERT INTO profile (userId, username, libraryVisibility) VALUES (?, ?, 'public'), (?, ?, 'private')",
            [
                ownerId,
                `metrics_${ownerId.slice(0, 8)}`,
                privateOwnerId,
                `metrics_${privateOwnerId.slice(0, 8)}`,
            ],
        );
        await source.query("INSERT INTO library (userId) VALUES (?), (?)", [
            ownerId,
            privateOwnerId,
        ]);

        const currentYear = new Date().getFullYear();
        const finishedAt = new Date(`${currentYear}-02-01T12:00:00Z`);
        for (const [gameId, visibility, dates] of [
            [PUBLIC_GAME, LibraryVisibility.Public, false],
            [FINISHED_GAME, LibraryVisibility.Public, true],
            [PRIVATE_GAME, LibraryVisibility.Private, true],
        ] as const) {
            await source.query(
                "INSERT INTO collection_entry (id, gameId, libraryUserId, status, startedAt, finishedAt, visibility) VALUES (?, ?, ?, 'finished', ?, ?, ?)",
                [
                    randomUUID(),
                    gameId,
                    ownerId,
                    dates ? finishedAt : null,
                    dates ? finishedAt : null,
                    visibility,
                ],
            );
        }

        await source.query(
            "INSERT INTO collection (id, libraryUserId, name, isPublic) VALUES (?, ?, 'Metrics public collection', 1), (?, ?, 'Metrics private collection', 0)",
            [randomUUID(), ownerId, randomUUID(), ownerId],
        );
        await source.query(
            "INSERT INTO user_playtime (source, profileUserId, gameId, platformId, totalPlaytimeSeconds) VALUES ('steam', ?, ?, ?, ?), ('steam', ?, ?, ?, ?), ('steam', ?, ?, ?, ?)",
            [
                ownerId,
                PUBLIC_GAME,
                PLATFORM,
                100,
                ownerId,
                PRIVATE_GAME,
                PLATFORM,
                50,
                ownerId,
                PLAYTIME_ONLY_GAME,
                PLATFORM,
                25,
            ],
        );
        await source.query(
            "INSERT INTO user_playtime (source, profileUserId, gameId, platformId, totalPlaytimeSeconds) VALUES ('steam', ?, ?, ?, ?)",
            [privateOwnerId, PRIVATE_LIBRARY_GAME, PLATFORM, 60],
        );
    });

    afterAll(async () => {
        if (!source?.isInitialized) return;
        await source.query("DELETE FROM library WHERE userId IN (?, ?)", [
            ownerId,
            privateOwnerId,
        ]);
        await source.query("DELETE FROM profile WHERE userId IN (?, ?)", [
            ownerId,
            privateOwnerId,
        ]);
        await source.query("DELETE FROM game WHERE id IN (?, ?, ?, ?, ?)", [
            PUBLIC_GAME,
            FINISHED_GAME,
            PRIVATE_GAME,
            PLAYTIME_ONLY_GAME,
            PRIVATE_LIBRARY_GAME,
        ]);
        await source.query("DELETE FROM game_platform WHERE id = ?", [
            PLATFORM,
        ]);
        await source.destroy();
    });

    it("counts only the visible games and collections of another user", async () => {
        const overview = await metrics.getStatsOverview(ownerId);

        expect(overview).toMatchObject({
            totalGames: 2,
            totalCollections: 1,
            totalEstimatedPlaytime: 125,
            totalFinishedGames: 1,
            totalFinishedGamesInYear: 1,
            totalPlayedGames: 1,
            totalPlayedGamesInYear: 1,
        });
    });

    it("keeps the owner's numbers unchanged", async () => {
        const overview = await metrics.getStatsOverview(ownerId, ownerId);

        expect(overview).toMatchObject({
            totalGames: 3,
            totalCollections: 2,
            totalEstimatedPlaytime: 175,
            totalFinishedGames: 2,
            totalFinishedGamesInYear: 2,
            totalPlayedGames: 2,
            totalPlayedGamesInYear: 2,
        });
    });

    it("returns zeros to a viewer who may not see the library", async () => {
        const overview = await metrics.getStatsOverview(privateOwnerId);

        expect(overview).toMatchObject({
            totalGames: 0,
            totalCollections: 0,
            totalEstimatedPlaytime: 0,
            totalFinishedGames: 0,
            totalFinishedGamesInYear: 0,
            totalPlayedGames: 0,
            totalPlayedGamesInYear: 0,
        });
        // The owner of the hidden library still gets their playtime.
        const ownOverview = await metrics.getStatsOverview(
            privateOwnerId,
            privateOwnerId,
        );
        expect(ownOverview.totalEstimatedPlaytime).toBe(60);
    });
});
