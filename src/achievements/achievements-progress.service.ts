import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
    DataSource,
    EntityManager,
    FindOptionsWhere,
    In,
    IsNull,
} from "typeorm";
import { LevelService } from "../level/level.service";
import { ActivitiesQueueService } from "../activities/activities-queue/activities-queue.service";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { AchievementDefinition } from "./entities/achievement-definition.entity";
import { AchievementTier } from "./entities/achievement-tier.entity";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { AchievementStatus } from "./achievements.constants";
import {
    ACHIEVEMENT_METRICS,
    AchievementWindow,
} from "./metrics/achievement-metrics";

export type GrantMode = "live" | "backfill" | "manual";

export const BACKFILL_BATCH_SIZE = 500;

/**
 * The event window wins over the definition's own window (they are mutually exclusive).
 */
export function effectiveWindow(
    definition: AchievementDefinition,
): AchievementWindow | null {
    if (definition.event) {
        return {
            startsAt: definition.event.startsAt,
            endsAt: definition.event.endsAt,
        };
    }
    if (definition.startsAt && definition.endsAt) {
        return { startsAt: definition.startsAt, endsAt: definition.endsAt };
    }
    return null;
}

/**
 * Evaluates metrics and grants achievement tiers. grantTiers is the only grant path.
 */
@Injectable()
export class AchievementsProgressService {
    private readonly logger = new Logger(AchievementsProgressService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly levelService: LevelService,
        private readonly activitiesQueueService: ActivitiesQueueService,
    ) {}

    /**
     * Published definitions that are not tied to an unpublished event.
     */
    findEvaluable(where: FindOptionsWhere<AchievementDefinition> = {}) {
        return this.dataSource.getRepository(AchievementDefinition).find({
            where: [
                {
                    ...where,
                    status: AchievementStatus.PUBLISHED,
                    eventId: IsNull(),
                },
                {
                    ...where,
                    status: AchievementStatus.PUBLISHED,
                    event: { status: AchievementStatus.PUBLISHED },
                },
            ],
            relations: { tiers: true, event: true },
            order: { createdAt: "ASC", tiers: { level: "ASC" } },
        });
    }

    computeValue(
        manager: EntityManager,
        userId: string,
        definition: AchievementDefinition,
    ) {
        const metric = ACHIEVEMENT_METRICS.get(definition.metric);
        if (!metric) {
            throw new Error(`Unknown achievement metric: ${definition.metric}`);
        }
        return metric.compute(
            manager,
            userId,
            definition.criteria,
            effectiveWindow(definition),
        );
    }

    async evaluate(userId: string, metricKey: string) {
        const metric = ACHIEVEMENT_METRICS.get(metricKey);
        if (!metric) {
            this.logger.warn(
                `Ignoring unknown achievement metric ${metricKey}`,
            );
            return;
        }
        const definitions = await this.findEvaluable({ metric: metricKey });
        if (definitions.length === 0) return;

        // Definitions sharing criteria and window share one query
        const values = new Map<string, Promise<number>>();
        const valueOf = (definition: AchievementDefinition) => {
            const key = JSON.stringify([
                definition.criteria,
                effectiveWindow(definition),
            ]);
            if (!values.has(key)) {
                values.set(
                    key,
                    this.computeValue(
                        this.dataSource.manager,
                        userId,
                        definition,
                    ),
                );
            }
            return values.get(key)!;
        };

        const progress: Array<[string, string, number]> = [];
        for (const definition of definitions) {
            progress.push([userId, definition.id, await valueOf(definition)]);
        }
        await this.dataSource.query(
            "INSERT INTO achievement_progress (profileUserId, definitionId, value) VALUES ? ON DUPLICATE KEY UPDATE value = VALUES(value)",
            [progress],
        );

        const obtained = await this.dataSource
            .getRepository(ObtainedAchievement)
            .find({
                select: { achievementId: true, tier: true },
                where: {
                    profileUserId: userId,
                    achievementId: In(definitions.map(({ id }) => id)),
                },
            });
        for (const [index, definition] of definitions.entries()) {
            const value = progress[index][2];
            const levels = definition.tiers
                .filter(
                    (tier) =>
                        tier.threshold <= value &&
                        !obtained.some(
                            (row) =>
                                row.achievementId === definition.id &&
                                row.tier === tier.level,
                        ),
                )
                .map((tier) => tier.level);
            if (levels.length > 0) {
                await this.grantTiers(userId, definition, levels, "live");
            }
        }
    }

    /**
     * Idempotently grants `levels` of `definition` to the user, with their exp, in one transaction.
     * live/manual grants also notify (highest new tier only) and register a feed activity.
     * @returns the highest newly obtained tier, or null when nothing was new
     */
    async grantTiers(
        userId: string,
        definition: AchievementDefinition,
        levels: number[],
        mode: GrantMode,
    ) {
        const tiers = definition.tiers
            .filter((tier) => levels.includes(tier.level))
            .sort((a, b) => a.level - b.level);

        const granted = await this.dataSource.transaction(async (manager) => {
            let exp = 0;
            let highest: {
                obtainedAchievementId: number;
                tier: number;
            } | null = null;
            for (const tier of tiers) {
                const result = await manager.query(
                    "INSERT IGNORE INTO obtained_achievement (achievementId, profileUserId, tier) VALUES (?, ?, ?)",
                    [definition.id, userId, tier.level],
                );
                if (result.affectedRows !== 1) continue;
                await manager.increment(
                    AchievementTier,
                    { id: tier.id },
                    "obtainedCount",
                    1,
                );
                exp += tier.expReward;
                highest = {
                    obtainedAchievementId: result.insertId,
                    tier: tier.level,
                };
            }

            if (!highest) {
                if (mode === "manual") {
                    throw new HttpException(
                        "User already has this achievement.",
                        HttpStatus.BAD_REQUEST,
                    );
                }
                return null;
            }
            if (exp > 0) {
                await this.levelService.increaseExp(userId, exp, manager);
            }
            if (mode !== "backfill") {
                await appendNotificationIntent(manager, {
                    eventType: "achievement.unlocked",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    recipientUserId: userId,
                    actorUserId: null,
                    payload: {
                        obtainedAchievementId: highest.obtainedAchievementId,
                        achievementId: definition.id,
                        tier: highest.tier,
                    },
                });
            }
            return highest;
        });

        if (granted && mode !== "backfill") {
            // shortcut: enqueued after commit like other producers, a crash here loses only the feed item
            this.activitiesQueueService.register(
                {
                    type: ActivityType.ACHIEVEMENT_UNLOCKED,
                    sourceId: granted.obtainedAchievementId,
                    profileUserId: userId,
                },
                `achievement-unlocked-${granted.obtainedAchievementId}`,
            );
        }

        return granted;
    }

    /**
     * Retroactively grants one batch of a published definition, silently.
     * @returns the cursor for the next batch, or null when done
     */
    async backfill(definitionId: string, afterUserId: string | null) {
        const [definition] = await this.findEvaluable({ id: definitionId });
        if (!definition) return null;
        const metric = ACHIEVEMENT_METRICS.get(definition.metric);
        if (!metric) return null;

        const userIds = await metric.candidates(
            this.dataSource.manager,
            definition.criteria,
            effectiveWindow(definition),
            afterUserId,
            BACKFILL_BATCH_SIZE,
        );
        for (const userId of userIds) {
            const value = await this.computeValue(
                this.dataSource.manager,
                userId,
                definition,
            );
            await this.dataSource.query(
                "INSERT INTO achievement_progress (profileUserId, definitionId, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
                [userId, definition.id, value],
            );
            const levels = definition.tiers
                .filter((tier) => tier.threshold <= value)
                .map((tier) => tier.level);
            if (levels.length > 0) {
                await this.grantTiers(userId, definition, levels, "backfill");
            }
        }

        return userIds.length === BACKFILL_BATCH_SIZE
            ? userIds[userIds.length - 1]
            : null;
    }
}
