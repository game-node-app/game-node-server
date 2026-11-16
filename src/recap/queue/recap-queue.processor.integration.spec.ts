import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../../test/awards/awards-test-database";
import { RecapQueueProcessor } from "./recap-queue.processor";
import {
    RECAP_GOAL_REMINDER_JOB_NAME,
    RECAP_PROCESS_JOB_NAME,
} from "../recap.constants";
import { NotificationCampaignService } from "../../notifications/notification-campaign.service";
import { RecapWindowService } from "../recap-window.service";
import { YearRecapEdition } from "../entity/year-recap-edition.entity";

describe("Recap queue selection and goal reminder (integration)", () => {
    jest.setTimeout(120000);

    const database = "recap_queue_test";
    const year = 2026;
    const gameId = 9_100_000_000_001;
    const platformId = 9_100_000_000_010;

    let cleanup: () => Promise<void>;
    let dataSource: DataSource;
    let processor: RecapQueueProcessor;
    let queue: { addBulk: jest.Mock };
    let recapCreate: { createRecap: jest.Mock };
    let windowService: { getCurrentRecap: jest.Mock };

    const addUser = async (
        userId: string,
        createdAt = "2025-01-01",
        banExpires: Date | null = null,
    ) => {
        await dataSource.query(
            "INSERT INTO `user` (id, name, email, emailVerified, banned, banExpires) VALUES (?, ?, ?, 1, ?, ?)",
            [
                userId,
                "Recap fixture",
                `${userId}@recap-test.local`,
                banExpires ? 1 : 0,
                banExpires,
            ],
        );
        await dataSource.query(
            "INSERT INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, ?, NOW())",
            [userId, `u_${userId.slice(0, 16)}`, `${createdAt} 00:00:00`],
        );
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            userId,
        ]);
    };

    const addRecap = async (
        userId: string,
        options: {
            recapYear?: number;
            isFinal?: boolean;
            updatedAt?: string;
        } = {},
    ) => {
        await dataSource.query(
            `INSERT INTO year_recap
                (year, profileUserId, totalPlayedGames, totalPlaytimeSeconds, totalAddedGames,
                 totalFinishedGames, totalDroppedGames, isFinal, totalReviewsCreated,
                 totalCollectionsCreated, totalFollowersGained, totalLikesPerformed, createdAt, updatedAt)
             VALUES (?, ?, 0, 0, 0, 0, 0, ?, 0, 0, 0, 0, NOW(6), ?)`,
            [
                options.recapYear ?? year,
                userId,
                options.isFinal ? 1 : 0,
                `${options.updatedAt ?? `${year}-11-01`} 00:00:00`,
            ],
        );
    };

    const addEntry = async (
        userId: string,
        options: {
            game?: number;
            updatedAt?: string;
            createdAt?: string;
            finishedAt?: string | null;
        } = {},
    ) => {
        const id = randomUUID();
        const createdAt = options.createdAt ?? `${year}-06-01`;
        await dataSource.query(
            `INSERT INTO collection_entry
                (id, gameId, status, libraryUserId, finishedAt, createdAt, updatedAt)
             VALUES (?, ?, 'planned', ?, ?, ?, ?)`,
            [
                id,
                options.game ?? gameId,
                userId,
                options.finishedAt ?? null,
                `${createdAt} 00:00:00`,
                `${options.updatedAt ?? createdAt} 00:00:00`,
            ],
        );
        return id;
    };

    const addReview = async (
        userId: string,
        collectionEntryId: string,
        updatedAt = `${year}-11-03`,
    ) => {
        await dataSource.query(
            `INSERT INTO review (id, rating, gameId, profileUserId, collectionEntryId, createdAt, updatedAt)
             VALUES (?, 4, ?, ?, ?, ?, ?)`,
            [
                randomUUID(),
                gameId,
                userId,
                collectionEntryId,
                `${year}-10-01 00:00:00`,
                `${updatedAt} 00:00:00`,
            ],
        );
    };

    const liveWindow = {
        year,
        phase: "live" as const,
        opensAt: new Date(`${year}-11-15T00:00:00.000Z`),
        closesAt: new Date(`${year}-12-31T23:59:59.999Z`),
    };

    const jobsFor = (jobYear = year) =>
        queue.addBulk.mock.calls
            .flatMap(([jobs]: [{ name: string; data: any }[]]) => jobs)
            .filter((job) => job.data.year === jobYear);

    const withRealWindow = () =>
        new RecapQueueProcessor(
            recapCreate as any,
            new RecapWindowService(
                dataSource.getRepository(YearRecapEdition),
                dataSource,
            ),
            new NotificationCampaignService(dataSource),
            dataSource,
            queue as any,
        );

    beforeAll(async () => {
        const disposable = await createAwardsTestDatabase(database);
        cleanup = disposable.destroy;
        dataSource = disposable.source;

        await dataSource.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?)",
            [gameId, "Queue fixture", "queue-fixture"],
        );
        await dataSource.query(
            "INSERT INTO game_platform (id, name, abbreviation, category) VALUES (?, ?, ?, 1)",
            [platformId, "Queue Platform", "QUE"],
        );
        await dataSource.query(`CREATE TABLE IF NOT EXISTS \`user\` (
            \`id\` varchar(36) NOT NULL PRIMARY KEY,
            \`name\` varchar(255) NOT NULL,
            \`email\` varchar(255) NOT NULL UNIQUE,
            \`emailVerified\` boolean NOT NULL,
            \`image\` text,
            \`createdAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            \`updatedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            \`role\` varchar(255) NOT NULL DEFAULT 'user',
            \`banned\` boolean,
            \`banReason\` text,
            \`banExpires\` timestamp(3) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        queue = { addBulk: jest.fn(async () => []) };
        recapCreate = { createRecap: jest.fn(async () => undefined) };
        windowService = {
            getCurrentRecap: jest.fn(async () => liveWindow),
        };
        processor = new RecapQueueProcessor(
            recapCreate as any,
            windowService as any,
            new NotificationCampaignService(dataSource),
            dataSource,
            queue as any,
        );
    });

    beforeEach(async () => {
        queue.addBulk.mockClear();
        recapCreate.createRecap.mockClear();
        windowService.getCurrentRecap.mockReset();
        windowService.getCurrentRecap.mockResolvedValue(liveWindow);

        await dataSource.query("DELETE FROM notification_outbox");
        await dataSource.query("DELETE FROM notification_campaign");
        await dataSource.query("DELETE FROM year_goal");
        await dataSource.query("DELETE FROM review");
        await dataSource.query("DELETE FROM collection_entry");
        await dataSource.query("DELETE FROM user_playtime_history");
        await dataSource.query("DELETE FROM year_recap_edition");
        await dataSource.query("DELETE FROM year_recap");
        await dataSource.query("DELETE FROM library");
        await dataSource.query("DELETE FROM profile");
        await dataSource.query("DELETE FROM `user`");
    });

    afterAll(async () => {
        await cleanup?.();
    });

    it("enqueues missing Recaps and users active since their last generation", async () => {
        const missing = randomUUID();
        const upToDate = randomUUID();
        const playedSince = randomUUID();
        const librarySince = randomUUID();
        const reviewSince = randomUUID();
        const finalized = randomUUID();
        const ineligible = randomUUID();

        for (const userId of [
            missing,
            upToDate,
            playedSince,
            librarySince,
            reviewSince,
            finalized,
        ]) {
            await addUser(userId);
        }
        await addUser(ineligible, "2027-01-01");

        await addRecap(upToDate, { updatedAt: `${year}-11-10` });
        await addRecap(playedSince, { updatedAt: `${year}-11-01` });
        await addRecap(librarySince, { updatedAt: `${year}-11-01` });
        await addRecap(reviewSince, { updatedAt: `${year}-11-01` });
        await addRecap(finalized, {
            isFinal: true,
            updatedAt: `${year}-11-01`,
        });
        await addRecap(missing, { recapYear: year - 1, isFinal: true });

        await dataSource.query(
            `INSERT INTO user_playtime_history
                (source, profileUserId, gameId, totalPlaytimeSeconds, recentPlaytimeSeconds,
                 totalPlayCount, platformId, createdAt)
             VALUES ('steam', ?, ?, 100, 0, 0, ?, ?)`,
            [playedSince, gameId, platformId, `${year}-11-02 00:00:00`],
        );
        await addEntry(librarySince, { updatedAt: `${year}-11-02` });
        const reviewEntry = await addEntry(reviewSince, {
            updatedAt: `${year}-10-01`,
        });
        await addReview(reviewSince, reviewEntry);

        await (processor as any).findRelevantProfiles(new Date());

        const liveJobs = jobsFor(year).filter((job) => job.data.final === false);
        expect(liveJobs.map((job) => job.data.userId).sort()).toEqual(
            [missing, playedSince, librarySince, reviewSince].sort(),
        );
        expect(liveJobs.every((job) => job.name === RECAP_PROCESS_JOB_NAME)).toBe(
            true,
        );
    });

    it("enqueues only final jobs for the closed year", async () => {
        const nonFinal = randomUUID();
        const withoutRecap = randomUUID();
        const finalized = randomUUID();
        const ineligible = randomUUID();

        for (const userId of [nonFinal, withoutRecap, finalized]) {
            await addUser(userId);
        }
        await addUser(ineligible, "2027-01-01");

        await addRecap(nonFinal, { isFinal: false });
        await addRecap(finalized, { isFinal: true });
        windowService.getCurrentRecap.mockResolvedValue({
            ...liveWindow,
            phase: "closed",
        });

        await (processor as any).findRelevantProfiles(new Date());

        const closedJobs = jobsFor(year).filter((job) => job.data.final === true);
        expect(closedJobs.map((job) => job.data.userId).sort()).toEqual(
            [nonFinal, withoutRecap].sort(),
        );
        expect(
            closedJobs.every(
                (job) =>
                    job.name === RECAP_PROCESS_JOB_NAME &&
                    job.data.year === year,
            ),
        ).toBe(true);
    });

    it("waits for a stored later opening before generating the live year", async () => {
        const user = randomUUID();
        await addUser(user);
        await addRecap(user, { recapYear: year - 1 });
        await dataSource.query(
            "INSERT INTO year_recap_edition (year, opensAt, updatedAt) VALUES (?, ?, NOW(6))",
            [year, `${year}-12-01 00:00:00`],
        );
        const processorWithWindow = withRealWindow();

        await (processorWithWindow as any).findRelevantProfiles(
            new Date(`${year}-11-20T12:00:00.000Z`),
        );

        expect(jobsFor(year)).toEqual([]);
        expect(
            jobsFor(year - 1)
                .filter((job) => job.data.final === true)
                .map((job) => job.data.userId),
        ).toEqual([user]);

        queue.addBulk.mockClear();
        await (processorWithWindow as any).findRelevantProfiles(
            new Date(`${year}-12-01T00:00:00.000Z`),
        );

        expect(
            jobsFor(year)
                .filter((job) => job.data.final === false)
                .map((job) => job.data.userId),
        ).toEqual([user]);
    });

    it("enqueues the previous year's final generation on the first January tick", async () => {
        const nonFinal = randomUUID();
        const finalized = randomUUID();
        await addUser(nonFinal);
        await addUser(finalized);
        await addRecap(nonFinal, { isFinal: false });
        await addRecap(finalized, { isFinal: true });

        await (withRealWindow() as any).findRelevantProfiles(
            new Date("2027-01-01T04:00:00.000Z"),
        );

        expect(
            jobsFor(year)
                .filter((job) => job.data.final === true)
                .map((job) => job.data.userId),
        ).toEqual([nonFinal]);
        expect(
            jobsFor(year).filter((job) => job.data.final === false),
        ).toEqual([]);
    });

    it("forwards the resolved year and final flag to generation", async () => {
        await processor.process({
            name: RECAP_PROCESS_JOB_NAME,
            data: { userId: "user-1", year: 2027, final: true },
        } as any);

        expect(recapCreate.createRecap).toHaveBeenCalledWith("user-1", 2027, {
            final: true,
        });
    });

    it("sends one goal reminder per user on a double run", async () => {
        const ahead = randomUUID();
        const behind = randomUUID();
        const withoutGoal = randomUUID();

        for (const userId of [ahead, behind, withoutGoal]) {
            await addUser(userId);
        }
        await addEntry(ahead, {
            finishedAt: `${year}-02-01`,
            createdAt: `${year}-01-10`,
        });
        await addEntry(ahead, {
            finishedAt: `${year}-05-01`,
            createdAt: `${year}-03-10`,
        });
        await dataSource.query(
            "INSERT INTO year_goal (profileUserId, year, finishedGamesTarget, createdAt, updatedAt) VALUES (?, ?, ?, NOW(6), NOW(6))",
            [ahead, year, 18],
        );
        await dataSource.query(
            "INSERT INTO year_goal (profileUserId, year, finishedGamesTarget, createdAt, updatedAt) VALUES (?, ?, ?, NOW(6), NOW(6))",
            [behind, year, 12],
        );

        const run = new Date(`${year}-07-01T12:00:00.000Z`);
        await (processor as any).sendGoalReminders(run);
        await (processor as any).sendGoalReminders(run);

        const [campaign] = await dataSource.query(
            "SELECT `key`, completedAt FROM notification_campaign WHERE `key` = ?",
            [`goal:${year}:july`],
        );
        expect(campaign.key).toBe(`goal:${year}:july`);
        expect(campaign.completedAt).not.toBeNull();

        const reminders: {
            recipientUserId: string;
            payload: { year: number; target: number; finished: number };
        }[] = (
            await dataSource.query(
                "SELECT recipientUserId, payload FROM notification_outbox WHERE eventType = 'goal.reminder'",
            )
        ).map((row: { recipientUserId: string; payload: any }) => ({
            recipientUserId: row.recipientUserId,
            payload:
                typeof row.payload === "string"
                    ? JSON.parse(row.payload)
                    : row.payload,
        }));

        expect(reminders).toHaveLength(2);
        expect(
            reminders.find((row) => row.recipientUserId === ahead)?.payload,
        ).toEqual({ year, target: 18, finished: 2 });
        expect(
            reminders.find((row) => row.recipientUserId === behind)?.payload,
        ).toEqual({ year, target: 12, finished: 0 });
        expect(
            reminders.some((row) => row.recipientUserId === withoutGoal),
        ).toBe(false);
    });
});
