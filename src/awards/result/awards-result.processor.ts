import { Processor } from "@nestjs/bullmq";
import { AWARDS_RESULT_QUEUE_NAME } from "./constants";
import { AwardsService } from "../awards.service";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import dayjs from "dayjs";
import { AwardsEvent } from "../entity/awards-event.entity";
import { DataSource, EntityManager } from "typeorm";
import { AwardsResultService } from "./awards-result.service";
import { VotableAwardsCategoryDto } from "../dto/votable-awards-category.dto";
import { AwardsNominationService } from "../nomination/awards-nomination.service";
import {
    NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK,
    NotificationCampaignService,
} from "../../notifications/notification-campaign.service";
import {
    AWARDS_MILESTONES,
    AwardsMilestone,
} from "../../notifications/notifications.types";
import { AwardsCategoryResult } from "../entity/awards-category-result.entity";
import { AwardsCategoryResultWinner } from "../entity/awards-category-winner.entity";

interface CategoryVoteRow {
    gameId: number;
    position: number;
    votes: number;
    votesPct: number | string;
    playedVotes: number | string;
    totalPlayedVotes: number | string;
}

interface CampaignBudget {
    remaining: number;
}

// Played follows the ballot: playtime above zero, a playing/finished/dropped
// entry, or a started/finished date. Snapshot, so later play does not change it.
// language=MySQL
const CATEGORY_RANKING_SQL = `
    SELECT ranked.gameId,
           ranked.position,
           ranked.votes,
           ranked.votesPct,
           ranked.playedVotes,
           ranked.totalPlayedVotes
    FROM (
        SELECT totals.gameId,
               ROW_NUMBER() OVER (
                   ORDER BY totals.votes DESC, totals.playedVotes DESC, totals.gameId ASC
               ) AS position,
               totals.votes,
               totals.votes / SUM(totals.votes) OVER () AS votesPct,
               totals.playedVotes,
               SUM(totals.playedVotes) OVER () AS totalPlayedVotes
        FROM (
            SELECT v.gameId,
                   COUNT(*) AS votes,
                   SUM(up.profileUserId IS NOT NULL OR ce.profileUserId IS NOT NULL) AS playedVotes
            FROM awards_vote v
            LEFT JOIN (
                SELECT profileUserId, gameId
                FROM user_playtime
                WHERE totalPlaytimeSeconds > 0
                GROUP BY profileUserId, gameId
            ) up ON up.profileUserId = v.profileUserId AND up.gameId = v.gameId
            LEFT JOIN (
                SELECT libraryUserId AS profileUserId, gameId
                FROM collection_entry
                WHERE status IN ('playing', 'finished', 'dropped')
                   OR startedAt IS NOT NULL
                   OR finishedAt IS NOT NULL
                GROUP BY libraryUserId, gameId
            ) ce ON ce.profileUserId = v.profileUserId AND ce.gameId = v.gameId
            WHERE v.categoryId = ?
            GROUP BY v.gameId
        ) totals
    ) ranked
    ORDER BY ranked.position ASC
    LIMIT 10`;

@Processor(AWARDS_RESULT_QUEUE_NAME)
export class AwardsResultProcessor extends WorkerHostProcessor {
    constructor(
        private readonly awardsService: AwardsService,
        private readonly awardsResultService: AwardsResultService,
        private readonly awardsNominationService: AwardsNominationService,
        private readonly notificationCampaignService: NotificationCampaignService,
        private readonly dataSource: DataSource,
    ) {
        super();
    }

    async process() {
        await this.runTick();
    }

    /**
     * Hourly lifecycle tick: finalize nominees, compute results on or after the
     * results date, then fan out due milestones and resume pending campaigns.
     * One batch budget is shared by every campaign in the tick (design 4, 8).
     */
    async runTick(now: Date = new Date()): Promise<void> {
        const budget: CampaignBudget = {
            remaining: NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK,
        };
        const events = await this.awardsService.getEventsInLifecycleWindow(now);
        for (const event of events) {
            await this.runEventLifecycle(event, now, budget);
        }
        await this.resumeGoalCampaign(now, budget);
    }

    private async runEventLifecycle(
        event: AwardsEvent,
        now: Date,
        budget: CampaignBudget,
    ) {
        if (
            event.nominationEndDate != null &&
            !dayjs(now).isBefore(event.nominationEndDate)
        ) {
            await this.awardsNominationService.finalizeNominees(event.id);
        }
        if (
            !dayjs(now).isBefore(event.resultsDate) &&
            !(await this.awardsResultService.eventHasResults(event.id))
        ) {
            this.logger.log(`Computing results for event ${event.id}`);
            await this.processEventResults(event);
        }
        await this.runDueMilestones(event, now, budget);
    }

    /**
     * One transaction per event, guarded by UNIQUE(awards_category_result.categoryId).
     * Categories that already have a result are kept, so a partially computed
     * legacy event is repaired without retrying their inserts.
     */
    async processEventResults(event: Pick<AwardsEvent, "id">) {
        const categories = await this.awardsService.getCategoriesByEventId(
            event.id,
        );
        if (categories.length === 0) return;

        try {
            await this.dataSource.transaction(async (manager) => {
                for (const category of categories) {
                    const existing = await manager.countBy(
                        AwardsCategoryResult,
                        { categoryId: category.id },
                    );
                    if (existing > 0) continue;
                    await this.processCategoryResult(manager, category);
                }
            });
        } catch (error) {
            if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
                // A concurrent tick computed the same missing categories first.
                this.logger.warn(
                    `Results for event ${event.id} were already computed.`,
                );
                return;
            }
            throw error;
        }
    }

    private async processCategoryResult(
        manager: EntityManager,
        category: VotableAwardsCategoryDto,
    ) {
        // language=MySQL
        const statistics: {
            totalVotes: number | string;
            totalUniqueUserVotes: number | string;
            totalUniqueGames: number | string;
        }[] = await manager.query(
            `SELECT COUNT(av.id) AS totalVotes,
                    COUNT(DISTINCT av.profileUserId) AS totalUniqueUserVotes,
                    COUNT(DISTINCT av.gameId) AS totalUniqueGames
             FROM awards_vote av
             WHERE av.categoryId = ?`,
            [category.id],
        );
        const ranking: CategoryVoteRow[] = await manager.query(
            CATEGORY_RANKING_SQL,
            [category.id],
        );

        const totalPlayedVotes =
            ranking.length > 0 ? Number(ranking[0].totalPlayedVotes) : 0;
        const [first] = statistics;
        const insert = await manager.insert(AwardsCategoryResult, {
            categoryId: category.id,
            totalUniqueGamesSubmitted: Number(first?.totalUniqueGames ?? 0),
            totalUsersParticipating: Number(first?.totalUniqueUserVotes ?? 0),
            totalVotesCount: Number(first?.totalVotes ?? 0),
            totalPlayedVotesCount: totalPlayedVotes,
        });
        const resultId = insert.identifiers[0].id;

        if (ranking.length === 0) return;
        await manager.insert(
            AwardsCategoryResultWinner,
            ranking.map((row) => ({
                resultId,
                gameId: Number(row.gameId),
                position: Number(row.position),
                totalVotes: Number(row.votes),
                votesPercentage: Number(row.votesPct),
                playedVotes: Number(row.playedVotes),
                playedVotesPercentage:
                    totalPlayedVotes > 0
                        ? Number(row.playedVotes) / totalPlayedVotes
                        : 0,
            })),
        );
    }

    private async runDueMilestones(
        event: AwardsEvent,
        now: Date,
        budget: CampaignBudget,
    ) {
        for (const milestone of AWARDS_MILESTONES) {
            if (budget.remaining <= 0) return;
            const trigger = this.milestoneTrigger(event, milestone);
            if (trigger == null || dayjs(now).isBefore(trigger)) continue;
            // Stale milestones are never sent and never resumed.
            if (this.isMilestoneStale(event, milestone, now)) continue;
            if (
                milestone === "results_published" &&
                !(await this.awardsResultService.eventHasResults(event.id))
            ) {
                continue;
            }

            const progress = await this.notificationCampaignService.runCampaign(
                {
                    key: `awards:${event.year}:${milestone}`,
                    eventType: "awards.milestone",
                    payload: {
                        eventId: event.id,
                        year: event.year,
                        milestone,
                    },
                },
                { maxBatches: budget.remaining },
            );
            budget.remaining -= progress.batches;
        }
    }

    private milestoneTrigger(
        event: AwardsEvent,
        milestone: AwardsMilestone,
    ): Date | null {
        switch (milestone) {
            case "nominations_open":
                return event.nominationStartDate;
            case "nominations_close_reminder":
                return event.nominationEndDate == null
                    ? null
                    : dayjs(event.nominationEndDate)
                          .subtract(24, "hour")
                          .toDate();
            case "voting_open":
                return event.votingStartDate;
            case "voting_close_reminder":
                return dayjs(event.votingEndDate).subtract(48, "hour").toDate();
            case "results_published":
                return event.resultsDate;
        }
    }

    /**
     * Stale means the phase the milestone announces has ended: on a recovery
     * after voting closed, the voting milestones are skipped (design 8).
     */
    private isMilestoneStale(
        event: AwardsEvent,
        milestone: AwardsMilestone,
        now: Date,
    ): boolean {
        switch (milestone) {
            case "nominations_open":
            case "nominations_close_reminder":
                return (
                    event.nominationEndDate == null ||
                    !dayjs(now).isBefore(event.nominationEndDate)
                );
            case "voting_open":
            case "voting_close_reminder":
                return !dayjs(now).isBefore(event.votingEndDate);
            case "results_published":
                return false;
        }
    }

    /**
     * The 1 July goal campaign belongs to the Recap queue, but it can exceed one
     * tick's 20-batch budget; this tick resumes it even with no active event.
     */
    private async resumeGoalCampaign(now: Date, budget: CampaignBudget) {
        if (budget.remaining <= 0) return;
        const year = now.getUTCFullYear();
        const key = `goal:${year}:july`;
        const pending: unknown[] = await this.dataSource.query(
            "SELECT 1 FROM notification_campaign WHERE `key` = ? AND completedAt IS NULL LIMIT 1",
            [key],
        );
        if (pending.length === 0) return;

        const progress = await this.notificationCampaignService.runCampaign(
            { key, eventType: "goal.reminder", payload: { year } },
            { maxBatches: budget.remaining },
        );
        budget.remaining -= progress.batches;
    }
}
