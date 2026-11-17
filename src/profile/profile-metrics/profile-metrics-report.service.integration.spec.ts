import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import dayjs from "dayjs";
import {
    createLibraryAccessService,
    createNotificationTestDataSource,
} from "../../../test/notifications/notification-test-harness";
import { Review } from "../../reviews/entities/review.entity";
import { ReviewsService } from "../../reviews/reviews.service";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryToCollection } from "../../collections/collections-entries/entities/collection-entry-to-collection.entity";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileMetricsReportService } from "./profile-metrics-report.service";
import { Period } from "../../utils/period";
import {
    LibraryAudience,
    LIBRARY_VISIBILITY_LEVELS,
} from "../../libraries/library-visibility.constants";
import { LibraryAudienceKey } from "./library-audience-key";
import { setCacheManager } from "../../utils/cacheable";

const OWNER_AUDIENCE: LibraryAudienceKey = {
    audience: LibraryAudience.Owner,
    visibleEntryLevels: [...LIBRARY_VISIBILITY_LEVELS],
    hiddenFingerprint: "none",
};
const HIDDEN_LIBRARY_AUDIENCE: LibraryAudienceKey = {
    audience: LibraryAudience.Everyone,
    visibleEntryLevels: [],
    hiddenFingerprint: "all",
};
/** A second game so hiding one can leave the other visible. */
const HIDDEN_GAME = 941002;

jest.setTimeout(120_000);

describe("ProfileMetricsReportService activity counts (MySQL)", () => {
    let dataSource: DataSource;
    let report: ProfileMetricsReportService;

    beforeAll(async () => {
        // Every call is a cache miss, so the decorator runs the real method.
        setCacheManager({
            get: async () => undefined,
            set: async () => undefined,
        } as never);

        dataSource = await createNotificationTestDataSource();
        const reviews = new ReviewsService(
            dataSource.getRepository(Review),
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        const entries = new CollectionsEntriesService(
            dataSource.getRepository(CollectionEntry),
            dataSource.getRepository(CollectionEntryToCollection),
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            undefined,
            createLibraryAccessService(dataSource),
        );
        report = new ProfileMetricsReportService(
            { getTotalPlaytimeForPeriod: async () => [] } as any,
            reviews,
            entries,
            { hiddenGameIds: async () => [] } as any,
        );
        await dataSource.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (?, ?, ?)",
            [HIDDEN_GAME, "Metrics hidden game", "metrics-hidden-game-fixture"],
        );
    });

    afterAll(async () => {
        if (!dataSource?.isInitialized) return;
        // Cascades to the entries' reviews; the game FK from entries does not cascade.
        await dataSource.query(
            "DELETE FROM collection_entry WHERE gameId = ?",
            [HIDDEN_GAME],
        );
        await dataSource.query("DELETE FROM game WHERE id = ?", [HIDDEN_GAME]);
        await dataSource.destroy();
    });

    async function createUser() {
        const userId = randomUUID();
        await dataSource.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [userId, `metrics_${userId.slice(0, 12)}`],
        );
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            userId,
        ]);
        return userId;
    }

    async function createEntry(
        userId: string,
        dates: {
            startedAt: Date | null;
            finishedAt: Date | null;
            updatedAt: Date;
        },
        gameId = 1,
    ) {
        const id = randomUUID();
        await dataSource.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, status, startedAt, finishedAt, updatedAt) VALUES (?, ?, ?, 'planned', ?, ?, ?)",
            [
                id,
                gameId,
                userId,
                dates.startedAt,
                dates.finishedAt,
                dates.updatedAt,
            ],
        );
        return id;
    }

    async function createReview(userId: string, createdAt: Date, gameId = 1) {
        const collectionEntryId = await createEntry(
            userId,
            {
                startedAt: null,
                finishedAt: null,
                updatedAt: createdAt,
            },
            gameId,
        );
        await dataSource.query(
            "INSERT INTO review (id, rating, gameId, profileUserId, collectionEntryId, createdAt) VALUES (?, 4, ?, ?, ?, ?)",
            [randomUUID(), gameId, userId, collectionEntryId, createdAt],
        );
    }

    it("returns zeros when the user had no activity", async () => {
        const userId = await createUser();

        await expect(
            report.getActivityCountsSince(userId, dayjs()),
        ).resolves.toEqual({ reviewed: 0, finished: 0, played: 0 });
    });

    it("counts reviews strictly after the window start, for that user only", async () => {
        const userId = await createUser();
        const otherUserId = await createUser();
        const since = new Date(Math.floor(Date.now() / 1000) * 1000);

        await createReview(userId, since);
        await createReview(userId, new Date(since.getTime() + 1000));
        await createReview(otherUserId, new Date(since.getTime() + 1000));

        await expect(
            report.getActivityCountsSince(userId, dayjs(since)),
        ).resolves.toMatchObject({ reviewed: 1 });
    });

    it("counts started and finished entries independently inside the updated window", async () => {
        const userId = await createUser();
        const otherUserId = await createUser();
        const since = new Date(Math.floor(Date.now() / 1000) * 1000);
        const before = new Date(since.getTime() - 3_600_000);
        const after = new Date(since.getTime() + 3_600_000);

        // Started and finished in the same window: both counts include it.
        await createEntry(userId, {
            startedAt: after,
            finishedAt: after,
            updatedAt: after,
        });
        // Exactly on the window start: neither date is strictly after it.
        await createEntry(userId, {
            startedAt: since,
            finishedAt: since,
            updatedAt: after,
        });
        // Status dates after the start, but not updated in the window.
        await createEntry(userId, {
            startedAt: after,
            finishedAt: null,
            updatedAt: before,
        });
        // Only finished after the start.
        await createEntry(userId, {
            startedAt: since,
            finishedAt: after,
            updatedAt: after,
        });
        await createEntry(otherUserId, {
            startedAt: after,
            finishedAt: after,
            updatedAt: after,
        });

        await expect(
            report.getActivityCountsSince(userId, dayjs(since)),
        ).resolves.toEqual({ reviewed: 0, finished: 2, played: 1 });
    });

    it("excludes hidden games from the period counts", async () => {
        const userId = await createUser();
        const since = new Date(Math.floor(Date.now() / 1000) * 1000);
        const after = new Date(since.getTime() + 3_600_000);

        await createEntry(
            userId,
            { startedAt: after, finishedAt: after, updatedAt: after },
            1,
        );
        await createEntry(
            userId,
            { startedAt: after, finishedAt: after, updatedAt: after },
            HIDDEN_GAME,
        );
        await createReview(userId, after, 1);
        await createReview(userId, after, HIDDEN_GAME);

        await expect(
            report.getActivityCountsSince(userId, dayjs(since)),
        ).resolves.toEqual({ reviewed: 2, finished: 2, played: 2 });
        await expect(
            report.getActivityCountsSince(userId, dayjs(since), [HIDDEN_GAME]),
        ).resolves.toEqual({ reviewed: 1, finished: 1, played: 1 });
    });

    it("returns zeros to a viewer who may not see the library", async () => {
        const userId = await createUser();
        const now = new Date();

        await createEntry(userId, {
            startedAt: now,
            finishedAt: now,
            updatedAt: now,
        });
        await createReview(userId, now);

        await expect(
            report.generateReport(userId, Period.WEEK, HIDDEN_LIBRARY_AUDIENCE),
        ).resolves.toEqual({
            reviewedInPeriod: 0,
            playtimeSecondsInPeriod: 0,
            finishedInPeriod: 0,
            playedInPeriod: 0,
        });
    });

    it("keeps the owner's report unchanged", async () => {
        const userId = await createUser();
        const now = new Date();

        await createEntry(userId, {
            startedAt: now,
            finishedAt: now,
            updatedAt: now,
        });
        await createReview(userId, now);

        await expect(
            report.generateReport(userId, Period.WEEK, OWNER_AUDIENCE),
        ).resolves.toEqual({
            reviewedInPeriod: 1,
            playtimeSecondsInPeriod: 0,
            finishedInPeriod: 1,
            playedInPeriod: 1,
        });
    });
});
