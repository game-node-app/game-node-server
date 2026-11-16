import "reflect-metadata";
import { DataSource, Repository } from "typeorm";
import { createAwardsTestDatabase } from "../../../test/awards/awards-test-database";
import { AwardsResultProcessor } from "./awards-result.processor";
import { AwardsResultService } from "./awards-result.service";
import { AwardsService } from "../awards.service";
import { AwardsNominationService } from "../nomination/awards-nomination.service";
import { NotificationCampaignService } from "../../notifications/notification-campaign.service";
import { NotificationOutbox } from "../../notifications/entity/notification-outbox.entity";
import { AwardsEvent } from "../entity/awards-event.entity";
import { AwardsCategory } from "../entity/awards-category.entity";
import { AwardsCategoryResult } from "../entity/awards-category-result.entity";
import { AwardsCategorySuggestion } from "../entity/awards-category-suggestion.entity";
import { AwardsVote } from "../entity/awards-vote.entity";
import { AwardsNomination } from "../entity/awards-nomination.entity";
import { Game } from "../../game/game-repository/entities/game.entity";

const DATABASE = "awards_result_processor_test";

const NOM_USER_A = "11111111-0000-4000-8000-000000000001";
const NOM_USER_B = "11111111-0000-4000-8000-000000000002";
const LATE_USER = "22222222-0000-4000-8000-000000000001";
const STALE_USER = "33333333-0000-4000-8000-000000000001";

const NOM_GAME_1 = 601;
const NOM_GAME_2 = 602;
const NOM_GAME_3 = 603;
const OTHER_GAME = 604;

jest.setTimeout(180000);

describe("Awards lifecycle tick", () => {
    let cleanup: () => Promise<void>;
    let source: DataSource;
    let processor: AwardsResultProcessor;
    let resultService: AwardsResultService;
    let awardsService: AwardsService;
    let categoryRepository: Repository<AwardsCategory>;
    let notificationCampaignService: NotificationCampaignService;

    let nomEvent: AwardsEvent;
    let nomCategory: AwardsCategory;
    let nomPersonalCategory: AwardsCategory;
    let oldEvent: AwardsEvent;
    let staleEvent: AwardsEvent;
    let staleCategory: AwardsCategory;
    let zeroCategoryEvent: AwardsEvent;
    let lateEvent: AwardsEvent;

    const intentsFor = (userId: string) =>
        source.getRepository(NotificationOutbox).find({
            where: { recipientUserId: userId },
            order: { id: "ASC" },
        });

    const campaignRow = async (key: string) => {
        const rows = await source.query(
            "SELECT `key`, cursorUserId, completedAt FROM notification_campaign WHERE `key` = ?",
            [key],
        );
        return (
            (rows[0] as
                | { cursorUserId: string | null; completedAt: Date | null }
                | undefined) ?? null
        );
    };

    async function addUser(userId: string, username: string) {
        await source.query(
            "INSERT INTO `user` (id, name, email, emailVerified) VALUES (?, ?, ?, 1)",
            [userId, username, `${userId}@awards-tick.local`],
        );
        await source.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [userId, username],
        );
    }

    beforeAll(async () => {
        const database = await createAwardsTestDatabase(DATABASE);
        cleanup = database.destroy;
        source = database.source;

        const eventRepository = source.getRepository(AwardsEvent);
        categoryRepository = source.getRepository(AwardsCategory);
        resultService = new AwardsResultService(
            source.getRepository(AwardsCategoryResult),
            source.getRepository(AwardsVote),
        );
        awardsService = new AwardsService(eventRepository, categoryRepository);
        awardsService = new AwardsService(eventRepository, categoryRepository);
        notificationCampaignService = new NotificationCampaignService(source);
        processor = new AwardsResultProcessor(
            awardsService,
            resultService,
            new AwardsNominationService(
                source.getRepository(AwardsNomination),
                categoryRepository,
                source.getRepository(Game),
                awardsService,
                source,
            ),
            notificationCampaignService,
            source,
        );

        await source.query(`CREATE TABLE IF NOT EXISTS \`user\` (
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

        await addUser(NOM_USER_A, "nom-a");
        await addUser(NOM_USER_B, "nom-b");
        await addUser(LATE_USER, "late");
        await addUser(STALE_USER, "stale");

        await source.query(
            "INSERT INTO game (id, name, slug) VALUES (?, 'Nominee 1', 'tick-nominee-1'), (?, 'Nominee 2', 'tick-nominee-2'), (?, 'Nominee 3', 'tick-nominee-3'), (?, 'Other', 'tick-other')",
            [NOM_GAME_1, NOM_GAME_2, NOM_GAME_3, OTHER_GAME],
        );

        nomEvent = await eventRepository.save({
            year: 2026,
            nominationStartDate: new Date("2026-11-01T00:00:00Z"),
            nominationEndDate: new Date("2026-11-16T00:00:00Z"),
            votingStartDate: new Date("2026-12-01T00:00:00Z"),
            votingEndDate: new Date("2026-12-20T00:00:00Z"),
            resultsDate: new Date("2026-12-27T00:00:00Z"),
        });
        nomCategory = await categoryRepository.save({
            eventId: nomEvent.id,
            name: "Narrativa",
            description: "Nominations",
            order: 1,
            nomineeCount: 2,
        });
        nomPersonalCategory = await categoryRepository.save({
            eventId: nomEvent.id,
            name: "Personal GOTY",
            description: "Personal GOTY",
            order: 0,
            isPersonalGOTY: true,
        });
        await source.query(
            "INSERT INTO awards_nomination (categoryId, gameId, profileUserId) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)",
            [
                nomCategory.id,
                NOM_GAME_1,
                NOM_USER_A,
                nomCategory.id,
                NOM_GAME_1,
                NOM_USER_B,
                nomCategory.id,
                NOM_GAME_2,
                NOM_USER_A,
                nomCategory.id,
                NOM_GAME_3,
                NOM_USER_B,
            ],
        );

        oldEvent = await eventRepository.save({
            year: 2025,
            votingStartDate: new Date("2026-08-01T00:00:00Z"),
            votingEndDate: new Date("2026-08-20T00:00:00Z"),
            resultsDate: new Date("2026-09-01T00:00:00Z"),
        });
        const oldCategory = await categoryRepository.save({
            eventId: oldEvent.id,
            name: "Old",
            description: "Outside the 40-day window",
            order: 1,
        });
        await source.query(
            "INSERT INTO awards_vote (categoryId, gameId, profileUserId) VALUES (?, ?, ?)",
            [oldCategory.id, OTHER_GAME, NOM_USER_A],
        );

        staleEvent = await eventRepository.save({
            year: 2027,
            nominationStartDate: new Date("2026-12-01T00:00:00Z"),
            nominationEndDate: new Date("2026-12-10T00:00:00Z"),
            votingStartDate: new Date("2027-02-01T00:00:00Z"),
            votingEndDate: new Date("2027-02-20T00:00:00Z"),
            resultsDate: new Date("2027-03-10T00:00:00Z"),
        });
        staleCategory = await categoryRepository.save({
            eventId: staleEvent.id,
            name: "Stale",
            description: "Stale milestones",
            order: 1,
        });
        await source.query(
            "INSERT INTO awards_vote (categoryId, gameId, profileUserId) VALUES (?, ?, ?)",
            [staleCategory.id, OTHER_GAME, NOM_USER_A],
        );

        zeroCategoryEvent = await eventRepository.save({
            year: 2028,
            votingStartDate: new Date("2027-03-01T00:00:00Z"),
            votingEndDate: new Date("2027-03-10T00:00:00Z"),
            resultsDate: new Date("2027-03-20T00:00:00Z"),
        });

        lateEvent = await eventRepository.save({
            year: 2029,
            votingStartDate: new Date("2027-05-01T12:00:00Z"),
            votingEndDate: new Date("2027-05-20T00:00:00Z"),
            resultsDate: new Date("2027-05-10T00:00:00Z"),
        });
    });

    afterAll(async () => {
        await cleanup?.();
    });

    it("finalizes nominees once the nominations phase has ended", async () => {
        await processor.runTick(new Date("2026-11-20T12:00:00Z"));

        const finalized = await categoryRepository.findOneByOrFail({
            id: nomCategory.id,
        });
        expect(finalized.nomineesFinalizedAt).not.toBeNull();
        const suggestions = await source
            .getRepository(AwardsCategorySuggestion)
            .find({ where: { categoryId: nomCategory.id } });
        expect(
            suggestions.map((row) => Number(row.gameId)).sort((a, b) => a - b),
        ).toEqual([NOM_GAME_1, NOM_GAME_2]);

        const personal = await categoryRepository.findOneByOrFail({
            id: nomPersonalCategory.id,
        });
        expect(personal.nomineesFinalizedAt).toBeNull();
    });

    it("does not compute results before the results date and sends voting open once", async () => {
        await processor.runTick(new Date("2026-12-10T12:00:00Z"));

        expect(await resultService.eventHasResults(nomEvent.id)).toBe(false);
        const votingOpen = (await intentsFor(LATE_USER)).filter(
            (intent) =>
                intent.eventType === "awards.milestone" &&
                intent.payload.milestone === "voting_open" &&
                intent.payload.year === 2026,
        );
        expect(votingOpen).toHaveLength(1);
    });

    it("computes results on the next tick after a missed results day", async () => {
        await processor.runTick(new Date("2026-12-28T12:00:00Z"));

        expect(await resultService.eventHasResults(nomEvent.id)).toBe(true);
        const results = await resultService.getCategoryResultsByEventId(
            nomEvent.id,
        );
        expect(results).toHaveLength(2);
        expect(
            (await campaignRow("awards:2026:results_published"))?.completedAt,
        ).not.toBeNull();

        const published = (await intentsFor(LATE_USER)).filter(
            (intent) =>
                intent.payload.milestone === "results_published" &&
                intent.payload.year === 2026,
        );
        expect(published).toHaveLength(1);

        await processor.runTick(new Date("2026-12-28T12:00:00Z"));
        expect(
            await resultService.getCategoryResultsByEventId(nomEvent.id),
        ).toHaveLength(2);
        expect(
            (await intentsFor(LATE_USER)).filter(
                (intent) => intent.payload.year === 2026,
            ),
        ).toHaveLength(2);
    });

    it("skips events outside the 40-day window", async () => {
        const now = new Date("2027-01-15T12:00:00Z");
        const window = await awardsService.getEventsInLifecycleWindow(now);
        expect(window.map((event) => event.id)).not.toContain(oldEvent.id);

        await processor.runTick(now);
        expect(await resultService.eventHasResults(oldEvent.id)).toBe(false);
    });

    it("skips stale milestones and never resumes a stale campaign", async () => {
        const now = new Date("2027-03-01T12:00:00Z");
        await processor.runTick(now);

        expect(await campaignRow("awards:2027:voting_open")).toBeNull();
        expect(await campaignRow("awards:2027:nominations_open")).toBeNull();
        expect(
            (await intentsFor(STALE_USER)).filter(
                (intent) => intent.payload.year === 2027,
            ),
        ).toHaveLength(0);

        // An interrupted fan-out from before the phase ended must stay frozen.
        await source.query(
            "INSERT INTO notification_campaign (`key`, eventType, payload, createdAt) VALUES ('awards:2027:voting_open', 'awards.milestone', ?, CURRENT_TIMESTAMP(6))",
            [
                JSON.stringify({
                    eventId: staleEvent.id,
                    year: 2027,
                    milestone: "voting_open",
                }),
            ],
        );
        await processor.runTick(now);
        expect(await campaignRow("awards:2027:voting_open")).toMatchObject({
            cursorUserId: null,
            completedAt: null,
        });
        expect(
            (await intentsFor(STALE_USER)).filter(
                (intent) => intent.payload.year === 2027,
            ),
        ).toHaveLength(0);
    });

    it("publishes results only once results exist", async () => {
        const now = new Date("2027-04-01T12:00:00Z");
        await processor.runTick(now);

        expect(await resultService.eventHasResults(zeroCategoryEvent.id)).toBe(
            false,
        );
        expect(await campaignRow("awards:2028:results_published")).toBeNull();

        expect(await resultService.eventHasResults(staleEvent.id)).toBe(true);
        expect(
            (await campaignRow("awards:2027:results_published"))?.completedAt,
        ).not.toBeNull();
    });

    it("sends a late but still valid milestone once", async () => {
        const now = new Date("2027-05-01T17:00:00Z");
        await processor.runTick(now);

        const votingOpen = (await intentsFor(LATE_USER)).filter(
            (intent) =>
                intent.payload.milestone === "voting_open" &&
                intent.payload.year === 2029,
        );
        expect(votingOpen).toHaveLength(1);
        expect(
            (await campaignRow("awards:2029:voting_open"))?.completedAt,
        ).not.toBeNull();

        await processor.runTick(now);
        expect(
            (await intentsFor(LATE_USER)).filter(
                (intent) =>
                    intent.payload.milestone === "voting_open" &&
                    intent.payload.year === 2029,
            ),
        ).toHaveLength(1);
    });

    it("resumes a goal campaign that exhausted one tick's batch budget", async () => {
        const goalUsers: string[] = [];
        for (let index = 0; index < 45; index++) {
            const userId = `44444444-0000-4000-8000-${index
                .toString(16)
                .padStart(12, "0")}`;
            await addUser(userId, `goal-${index}`);
            await source.query(
                "INSERT INTO year_goal (profileUserId, year, finishedGamesTarget, createdAt, updatedAt) VALUES (?, 2027, 12, NOW(6), NOW(6))",
                [userId],
            );
            goalUsers.push(userId);
        }

        const request = {
            key: "goal:2027:july",
            eventType: "goal.reminder" as const,
            payload: { year: 2027 },
        };
        expect(
            await notificationCampaignService.runCampaign(request, {
                batchSize: 2,
            }),
        ).toEqual({ completed: false, sent: 40, batches: 20 });

        // No awards event is active on 1 July, and the tick still finishes it.
        await processor.runTick(new Date("2027-07-01T13:00:00Z"));

        const reminders = (
            await source.getRepository(NotificationOutbox).find({
                where: { eventType: "goal.reminder" },
                order: { id: "ASC" },
            })
        ).filter((intent) => goalUsers.includes(intent.recipientUserId!));
        expect(reminders).toHaveLength(45);
        expect(
            new Set(reminders.map((intent) => intent.recipientUserId)).size,
        ).toBe(45);
        expect(
            reminders.every(
                (intent) =>
                    intent.payload.year === 2027 &&
                    intent.payload.target === 12,
            ),
        ).toBe(true);
        expect(
            (await campaignRow("goal:2027:july"))?.completedAt,
        ).not.toBeNull();
    });
});
