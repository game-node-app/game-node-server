import { InjectQueue, Processor } from "@nestjs/bullmq";
import {
    RECAP_CREATE_JOB_NAME,
    RECAP_GOAL_REMINDER_JOB_NAME,
    RECAP_PROCESS_JOB_NAME,
    RECAP_PROCESSOR_CONCURRENCY,
    RECAP_QUEUE_NAME,
    RECAP_SELECTION_PAGE_SIZE,
} from "../recap.constants";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Job, Queue } from "bullmq";
import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { RecapCreateService } from "../recap-create.service";
import { RecapWindowService } from "../recap-window.service";
import { RecapQueueProcessJobData } from "./recap-queue.types";
import { NotificationCampaignService } from "../../notifications/notification-campaign.service";

@Processor(RECAP_QUEUE_NAME, {
    concurrency: RECAP_PROCESSOR_CONCURRENCY,
})
export class RecapQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(RecapQueueProcessor.name);
    constructor(
        private readonly recapCreateService: RecapCreateService,
        private readonly recapWindowService: RecapWindowService,
        private readonly notificationCampaignService: NotificationCampaignService,
        private readonly dataSource: DataSource,
        @InjectQueue(RECAP_QUEUE_NAME) private readonly queue: Queue,
    ) {
        super();
    }

    async process(job: Job<RecapQueueProcessJobData | undefined>) {
        if (job.name === RECAP_CREATE_JOB_NAME) {
            await this.findRelevantProfiles();
            return;
        }
        if (job.name === RECAP_GOAL_REMINDER_JOB_NAME) {
            await this.sendGoalReminders();
            return;
        }
        if (job.name === RECAP_PROCESS_JOB_NAME) {
            await this.processRecapCreateJob(job.data!);
            return;
        }
    }

    private async findRelevantProfiles(now = new Date()) {
        const current = await this.recapWindowService.getCurrentRecap(now);

        if (current.phase === "live") {
            await this.enqueueInPages(
                current.year,
                false,
                `SELECT p.userId AS userId
                FROM profile p
                WHERE p.createdAt < ?
                  AND p.userId > ?
                  AND (
                    NOT EXISTS (
                        SELECT 1 FROM year_recap r
                        WHERE r.profileUserId = p.userId AND r.year = ?
                    )
                    OR EXISTS (
                        SELECT 1 FROM year_recap r
                        WHERE r.profileUserId = p.userId AND r.year = ?
                          AND r.isFinal = 0
                          AND (
                            EXISTS (
                                SELECT 1 FROM user_playtime_history h
                                WHERE h.profileUserId = p.userId
                                  AND h.createdAt > r.updatedAt
                            )
                            OR EXISTS (
                                SELECT 1 FROM collection_entry ce
                                WHERE ce.libraryUserId = p.userId
                                  AND ce.updatedAt > r.updatedAt
                            )
                            OR EXISTS (
                                SELECT 1 FROM review rv
                                WHERE rv.profileUserId = p.userId
                                  AND rv.updatedAt > r.updatedAt
                            )
                          )
                    )
                  )
                ORDER BY p.userId ASC
                LIMIT ?`,
                [
                    this.startOfNextYear(current.year),
                    current.year,
                    current.year,
                ],
            );
        }

        const closedYear =
            current.phase === "closed" ? current.year : current.year - 1;
        await this.enqueueInPages(
            closedYear,
            true,
            `SELECT p.userId AS userId
            FROM profile p
            WHERE p.createdAt < ?
              AND p.userId > ?
              AND NOT EXISTS (
                SELECT 1 FROM year_recap r
                WHERE r.profileUserId = p.userId AND r.year = ? AND r.isFinal = 1
              )
            ORDER BY p.userId ASC
            LIMIT ?`,
            [this.startOfNextYear(closedYear), closedYear],
        );
    }

    private startOfNextYear(year: number): Date {
        return new Date(Date.UTC(year + 1, 0, 1));
    }

    private async enqueueInPages(
        year: number,
        final: boolean,
        sql: string,
        params: unknown[],
    ) {
        let cursor = "";

        for (;;) {
            const rows: { userId: string }[] = await this.dataSource.query(
                sql,
                [
                    params[0],
                    cursor,
                    ...params.slice(1),
                    RECAP_SELECTION_PAGE_SIZE,
                ],
            );
            if (rows.length === 0) return;

            await this.queue.addBulk(
                rows.map(({ userId }) => ({
                    name: RECAP_PROCESS_JOB_NAME,
                    data: { userId, year, final },
                })),
            );

            if (rows.length < RECAP_SELECTION_PAGE_SIZE) return;
            cursor = rows[rows.length - 1].userId;
        }
    }

    async processRecapCreateJob(jobData: RecapQueueProcessJobData) {
        const year =
            jobData.year ??
            (await this.recapWindowService.getCurrentRecap()).year;
        await this.recapCreateService.createRecap(jobData.userId, year, {
            final: jobData.final ?? false,
        });
    }

    private async sendGoalReminders(now = new Date()) {
        const year = now.getUTCFullYear();
        await this.notificationCampaignService.runCampaign({
            key: `goal:${year}:july`,
            eventType: "goal.reminder",
            payload: { year },
        });

        this.logger.log(`Processed the ${year} goal reminder campaign.`);
    }
}
