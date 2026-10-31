import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Interval } from "@nestjs/schedule";
import { LessThanOrEqual, Repository } from "typeorm";
import { Transactional } from "typeorm-transactional";
import { ImporterBatchEffect } from "./entity/importer-batch-effect.entity";
import { UserLevel } from "../level/entities/user-level.entity";
import { LevelService } from "../level/level.service";
import {
    LevelActivitiesToIncreaseAmountMap,
    LevelIncreaseActivities,
} from "../level/level.constants";
import { ActivitiesQueueService } from "../activities/activities-queue/activities-queue.service";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";
import { AchievementsQueueService } from "../achievements/achievements-queue/achievements-queue.service";

@Injectable()
export class ImporterBatchEffectsService {
    private readonly logger = new Logger(ImporterBatchEffectsService.name);
    private running = false;

    constructor(
        @InjectRepository(ImporterBatchEffect)
        private readonly effects: Repository<ImporterBatchEffect>,
        private readonly levels: LevelService,
        private readonly activities: ActivitiesQueueService,
        private readonly achievements: AchievementsQueueService,
    ) {}

    @Interval(30000)
    async recover() {
        if (this.running) return;
        this.running = true;
        try {
            const pending = await this.effects.find({
                where: { nextAttemptAt: LessThanOrEqual(new Date()) },
                order: { nextAttemptAt: "ASC", createdAt: "ASC" },
                take: 50,
            });
            for (const effect of pending) {
                try {
                    await this.deliver(effect.id);
                } catch (error) {
                    const delay = Math.min(
                        3600000,
                        30000 * 2 ** Math.min(effect.attempts, 7),
                    );
                    await this.effects.update(
                        { id: effect.id },
                        {
                            attempts: () => "attempts + 1",
                            nextAttemptAt: new Date(Date.now() + delay),
                        },
                    );
                    this.logger.error({
                        event: "import-batch-effects-failed",
                        effectId: effect.id,
                        error,
                    });
                }
            }
        } finally {
            this.running = false;
        }
    }

    @Transactional()
    private async deliver(id: string) {
        const effect = await this.effects.findOne({
            where: { id },
            lock: { mode: "pessimistic_write" },
        });
        if (!effect) return;
        await this.effects.manager.getRepository(UserLevel).findOne({
            where: { userId: effect.libraryUserId },
            lock: { mode: "pessimistic_write" },
        });
        await this.levels.increaseExp(
            effect.libraryUserId,
            effect.entryIds.length *
                LevelActivitiesToIncreaseAmountMap[
                    LevelIncreaseActivities.COLLECTION_ENTRY_CREATED
                ],
        );
        for (const entryId of effect.entryIds)
            for (const collectionId of effect.collectionIds) {
                await this.activities.register(
                    {
                        sourceId: entryId,
                        complementarySourceId: collectionId,
                        type: ActivityType.COLLECTION_ENTRY,
                        profileUserId: effect.libraryUserId,
                    },
                    `import-${effect.id}-${entryId}-${collectionId}`,
                );
            }
        // Evaluated once from the final library state, not per imported game
        for (const metric of ["library_games", "games_finished"]) {
            await this.achievements.addTrackingJob({
                userId: effect.libraryUserId,
                metric,
            });
        }
        await this.effects.delete({ id });
    }
}
