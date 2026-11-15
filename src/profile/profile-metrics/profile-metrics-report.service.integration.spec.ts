import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import dayjs from "dayjs";
import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { Review } from "../../reviews/entities/review.entity";
import { ReviewsService } from "../../reviews/reviews.service";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryToCollection } from "../../collections/collections-entries/entities/collection-entry-to-collection.entity";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileMetricsReportService } from "./profile-metrics-report.service";

describe("ProfileMetricsReportService activity counts (MySQL)", () => {
    let dataSource: DataSource;
    let report: ProfileMetricsReportService;

    beforeAll(async () => {
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
        );
        report = new ProfileMetricsReportService({} as any, reviews, entries);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
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
    ) {
        const id = randomUUID();
        await dataSource.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, status, startedAt, finishedAt, updatedAt) VALUES (?, 1, ?, 'planned', ?, ?, ?)",
            [id, userId, dates.startedAt, dates.finishedAt, dates.updatedAt],
        );
        return id;
    }

    async function createReview(userId: string, createdAt: Date) {
        const collectionEntryId = await createEntry(userId, {
            startedAt: null,
            finishedAt: null,
            updatedAt: createdAt,
        });
        await dataSource.query(
            "INSERT INTO review (id, rating, gameId, profileUserId, collectionEntryId, createdAt) VALUES (?, 4, 1, ?, ?, ?)",
            [randomUUID(), userId, collectionEntryId, createdAt],
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
});
