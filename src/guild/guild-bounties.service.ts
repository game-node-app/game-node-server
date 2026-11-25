import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
    DataSource,
    EntityManager,
    In,
    IsNull,
    LessThanOrEqual,
    MoreThan,
    MoreThanOrEqual,
    Not,
    Repository,
} from "typeorm";
import {
    AchievementsProgressService,
    GrantedTier,
} from "../achievements/achievements-progress.service";
import { LevelService } from "../level/level.service";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import {
    ClaimGuildBountyResponseDto,
    CreateGuildBountyDto,
    GuildAdminBountyResponseDto,
    GuildBountiesResponseDto,
    GuildBountiesSummaryDto,
    GuildBountyDto,
    GuildBountyMilestoneRewardDto,
    GuildBountyMilestoneStateDto,
    GuildBountyTranslationDto,
    UpdateGuildBountyDto,
} from "./dto/guild-bounties.dto";
import {
    GuildChestResultDto,
    GuildRewardDescriptorDto,
} from "./dto/guild-rewards.dto";
import { GuildCommunityBountyClaim } from "./entities/guild-community-bounty-claim.entity";
import { GuildCommunityBountyTranslation } from "./entities/guild-community-bounty-translation.entity";
import { GuildCommunityBounty } from "./entities/guild-community-bounty.entity";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildEvaluationContext, evaluateGuildObjective } from "./evaluators";
import { GuildRankProgressionService } from "./guild-rank-progression.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";
import { validateGuildQuestRules } from "./guild-templates.constants";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import {
    DAY_MS,
    GUILD_BOUNTY_MILESTONES,
    GUILD_GLOBAL_XP_MULTIPLIER,
    GuildBountyStatus,
    GuildChestTierKey,
    GuildCriteria,
    GuildLocale,
    GuildObjectiveType,
    GuildRewardKind,
    GuildSealReason,
    computeGuildRank,
} from "./guild.constants";

/** Bounties stay claimable this long after `endsAt` (spec: community bounties). */
export const GUILD_BOUNTY_CLAIM_WINDOW_DAYS = 14;

/** Eligible contributors the scheduler notifies per tick (design 6). */
export const GUILD_BOUNTY_NOTIFICATION_BATCH = 500;

const MILESTONE_KEYS = GUILD_BOUNTY_MILESTONES.map(String);

const CHEST_KINDS: readonly GuildChestTierKey[] = [
    GuildRewardKind.CHEST_BRONZE,
    GuildRewardKind.CHEST_SILVER,
    GuildRewardKind.CHEST_GOLD,
    GuildRewardKind.CHEST_RELIC,
];

const RULES_LOCKED = {
    message: "This bounty's rules are locked by existing contributions.",
    code: "guild_bounty_rules_locked",
};

const claimWindowClosed = () =>
    new ConflictException({
        message: "This Community Bounty is not claimable.",
        code: "guild_bounty_not_claimable",
    });

function badRequest(message: string): never {
    throw new BadRequestException(message);
}

function trimRequired(value: string, field: string): string {
    const trimmed = value.trim();
    if (!trimmed) badRequest(`${field} must not be empty.`);
    return trimmed;
}

/** JSON columns may arrive parsed or as text depending on the driver path. */
function parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== "string") {
        return value != null && typeof value === "object"
            ? (value as T)
            : fallback;
    }
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

const parseClaimedMilestones = (value: unknown): number[] => {
    const parsed = parseJson<unknown>(value, []);
    return Array.isArray(parsed)
        ? parsed.filter((entry): entry is number => Number.isInteger(entry))
        : [];
};

const parseMilestoneRewards = (
    value: unknown,
): Record<string, GuildBountyMilestoneRewardDto> => {
    const parsed = parseJson<Record<string, GuildBountyMilestoneRewardDto>>(
        value,
        {},
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
};

/**
 * Server-wide cooperative Community Bounties (design 6): admin CRUD, capped
 * per-user contribution accounting, milestone claims and batched ready fan-out.
 * Contributions never touch `guild_contract`, so no personal slot is consumed.
 */
@Injectable()
export class GuildBountiesService {
    private readonly logger = new Logger(GuildBountiesService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly guildTimeToBeatService: GuildTimeToBeatService,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
        private readonly guildRewardsService: GuildRewardsService,
        private readonly guildSealsService: GuildSealsService,
        private readonly guildRankProgressionService: GuildRankProgressionService,
        private readonly levelService: LevelService,
        @Optional()
        private readonly achievementsProgressService?: AchievementsProgressService,
    ) {}

    private bountyRepository(
        manager?: EntityManager,
    ): Repository<GuildCommunityBounty> {
        return (manager ?? this.dataSource).getRepository(GuildCommunityBounty);
    }

    async listAdminBounties(): Promise<GuildAdminBountyResponseDto[]> {
        const bounties = await this.bountyRepository().find({
            relations: { translations: true },
            order: { createdAt: "DESC" },
        });
        return bounties.map((bounty) => this.toAdminDto(bounty));
    }

    async getAdminBounty(id: string): Promise<GuildAdminBountyResponseDto> {
        return this.toAdminDto(await this.findBountyOrFail(id));
    }

    async createAdminBounty(
        dto: CreateGuildBountyDto,
    ): Promise<GuildAdminBountyResponseDto> {
        const slug = trimRequired(dto.slug, "slug");
        await this.assertSlugAvailable(slug);
        const title = trimRequired(dto.title, "title");
        const description = trimRequired(dto.description, "description");
        const translations = this.validateTranslations(dto.translations);
        this.assertWindow(dto.startsAt, dto.endsAt);
        this.assertContributionRules(
            dto.targetTotal,
            dto.minUserContribution ?? 1,
            dto.maxUserContributionCap,
        );

        const id = randomUUID();
        await this.dataSource.transaction(async (manager) => {
            this.assertQuestRules(
                dto.objectiveType,
                dto.targetTotal,
                dto.criteria ?? {},
            );
            const milestoneRewards = await this.normalizeMilestoneRewards(
                manager,
                dto.milestoneRewards,
            );
            await manager.insert(GuildCommunityBounty, {
                id,
                slug,
                title,
                description,
                objectiveType: dto.objectiveType,
                criteria: dto.criteria ?? {},
                targetTotal: dto.targetTotal,
                currentTotal: 0,
                minUserContribution: dto.minUserContribution ?? 1,
                maxUserContributionCap: dto.maxUserContributionCap,
                milestoneRewards,
                startsAt: dto.startsAt,
                endsAt: dto.endsAt,
                status: GuildBountyStatus.DRAFT,
                publishedAt: null,
                reached100At: null,
            });
            await this.insertTranslations(manager, id, translations);
        });

        return this.getAdminBounty(id);
    }

    async updateAdminBounty(
        id: string,
        dto: UpdateGuildBountyDto,
    ): Promise<GuildAdminBountyResponseDto> {
        await this.dataSource.transaction(async (manager) => {
            await this.lockBounty(manager, id);
            const saved = await this.findBountyOrFail(
                id,
                this.bountyRepository(manager),
            );
            const slug =
                dto.slug !== undefined
                    ? trimRequired(dto.slug, "slug")
                    : saved.slug;
            if (slug !== saved.slug) await this.assertSlugAvailable(slug);

            await this.assertRulesUnlocked(manager, id, saved, dto);

            const startsAt = dto.startsAt ?? saved.startsAt;
            const endsAt = dto.endsAt ?? saved.endsAt;
            const objectiveType = dto.objectiveType ?? saved.objectiveType;
            const criteria = dto.criteria ?? saved.criteria;
            const targetTotal = dto.targetTotal ?? saved.targetTotal;
            const minUserContribution =
                dto.minUserContribution ?? saved.minUserContribution;
            const maxUserContributionCap =
                dto.maxUserContributionCap ?? saved.maxUserContributionCap;

            this.assertWindow(startsAt, endsAt);
            this.assertQuestRules(objectiveType, targetTotal, criteria);
            this.assertContributionRules(
                targetTotal,
                minUserContribution,
                maxUserContributionCap,
            );
            const milestoneRewards =
                dto.milestoneRewards === undefined
                    ? parseMilestoneRewards(saved.milestoneRewards)
                    : await this.normalizeMilestoneRewards(
                          manager,
                          dto.milestoneRewards,
                      );
            const translations =
                dto.translations === undefined
                    ? undefined
                    : this.validateTranslations(dto.translations);

            type BountyUpdate = Omit<
                Partial<GuildCommunityBounty>,
                "translations" | "milestoneRewards"
            > & {
                milestoneRewards: Record<string, GuildBountyMilestoneRewardDto>;
            };
            const changes: BountyUpdate = {
                slug,
                startsAt,
                endsAt,
                objectiveType,
                criteria,
                targetTotal,
                minUserContribution,
                maxUserContributionCap,
                milestoneRewards,
            };
            if (dto.title !== undefined) {
                changes.title = trimRequired(dto.title, "title");
            }
            if (dto.description !== undefined) {
                changes.description = trimRequired(
                    dto.description,
                    "description",
                );
            }
            await manager.update(
                GuildCommunityBounty,
                { id },
                {
                    ...changes,
                    // TypeORM's deep-partial typing rejects JSON index signatures.
                    milestoneRewards: changes.milestoneRewards as any,
                },
            );

            // Omitted preserves the stored set; an explicit array replaces it atomically.
            if (translations !== undefined) {
                await manager.delete(GuildCommunityBountyTranslation, {
                    bountyId: id,
                });
                await this.insertTranslations(manager, id, translations);
            }
        });

        return this.getAdminBounty(id);
    }

    async publishAdminBounty(
        id: string,
        now = new Date(),
    ): Promise<GuildAdminBountyResponseDto> {
        await this.dataSource.transaction(async (manager) => {
            await this.lockBounty(manager, id);
            const saved = await this.findBountyOrFail(
                id,
                this.bountyRepository(manager),
            );
            if (saved.status === GuildBountyStatus.ARCHIVED) {
                throw new ConflictException(
                    "Archived bounties can't be published.",
                );
            }
            if (saved.endsAt <= now) {
                badRequest("endsAt must be in the future to publish.");
            }
            await manager.update(
                GuildCommunityBounty,
                { id },
                {
                    status: GuildBountyStatus.PUBLISHED,
                    publishedAt: saved.publishedAt ?? now,
                },
            );
        });
        return this.getAdminBounty(id);
    }

    async archiveAdminBounty(id: string): Promise<GuildAdminBountyResponseDto> {
        await this.dataSource.transaction(async (manager) => {
            await this.lockBounty(manager, id);
            await manager.update(
                GuildCommunityBounty,
                { id },
                { status: GuildBountyStatus.ARCHIVED },
            );
        });
        return this.getAdminBounty(id);
    }

    /**
     * Records every qualifying action in each active bounty's window, deduplicated
     * by `(bountyId, profileUserId, sourceKey)` and capped per user. Personal
     * contracts are never read or touched.
     */
    async recordContributionsForUser(
        userId: string,
        now = new Date(),
    ): Promise<number> {
        const bounties = await this.bountyRepository().find({
            where: {
                status: GuildBountyStatus.PUBLISHED,
                startsAt: LessThanOrEqual(now),
                endsAt: MoreThan(now),
            },
            order: { startsAt: "ASC" },
        });

        let inserted = 0;
        for (const bounty of bounties) {
            const evaluation = await evaluateGuildObjective(
                this.evaluationContext(bounty, userId, now),
            );
            const sourceKeys =
                evaluation.sourceKeys.length > 0
                    ? evaluation.sourceKeys
                    : Array.from(
                          {
                              length: Math.min(
                                  Math.max(0, Math.floor(evaluation.progress)),
                                  bounty.maxUserContributionCap,
                              ),
                          },
                          (_, index) => `unit:${index + 1}`,
                      );
            if (sourceKeys.length === 0) continue;

            inserted += await this.recordContributionBatch(
                bounty,
                userId,
                [...new Set(sourceKeys)],
                now,
            );
        }
        return inserted;
    }

    /** Active bounties plus the 14-day post-end claim window (spec: bounties). */
    async listBounties(
        userId: string,
        locale?: GuildLocale,
        now = new Date(),
    ): Promise<GuildBountiesResponseDto> {
        const bounties = await this.bountyRepository().find({
            where: {
                status: GuildBountyStatus.PUBLISHED,
                startsAt: LessThanOrEqual(now),
                endsAt: MoreThanOrEqual(
                    new Date(
                        now.getTime() - GUILD_BOUNTY_CLAIM_WINDOW_DAYS * DAY_MS,
                    ),
                ),
            },
            relations: { translations: true },
            order: { startsAt: "ASC" },
        });
        if (bounties.length === 0) return { bounties: [] };

        const ids = bounties.map((bounty) => bounty.id);
        const placeholders = ids.map(() => "?").join(", ");
        const [contributionRows, claims] = await Promise.all([
            this.dataSource.query(
                `SELECT bountyId, SUM(units) AS units
                 FROM guild_community_bounty_contribution
                 WHERE profileUserId = ? AND bountyId IN (${placeholders})
                 GROUP BY bountyId`,
                [userId, ...ids],
            ),
            this.dataSource.getRepository(GuildCommunityBountyClaim).find({
                where: { profileUserId: userId, bountyId: In(ids) },
            }),
        ]);
        const contributionByBounty = new Map<string, number>(
            contributionRows.map(
                (row: { bountyId: string; units: number | string }) => [
                    row.bountyId,
                    Number(row.units),
                ],
            ),
        );
        const claimByBounty = new Map(
            claims.map((claim) => [
                claim.bountyId,
                parseClaimedMilestones(claim.claimedMilestones),
            ]),
        );

        return {
            bounties: bounties.map((bounty) =>
                this.toPlayerDto(
                    bounty,
                    contributionByBounty.get(bounty.id) ?? 0,
                    claimByBounty.get(bounty.id) ?? [],
                    locale,
                ),
            ),
        };
    }

    /** `GET /v1/guild` overview / Lina `community_bounty_ready` helper. */
    async getBountiesSummary(
        userId: string,
        now = new Date(),
    ): Promise<GuildBountiesSummaryDto> {
        const { bounties } = await this.listBounties(userId, undefined, now);
        return {
            activeBountiesCount: bounties.filter(
                (bounty) => bounty.endsAt > now,
            ).length,
            claimableBountiesCount: bounties.filter(
                (bounty) => bounty.hasClaimableMilestones,
            ).length,
        };
    }

    /**
     * Atomically grants every unlocked, unclaimed milestone to an eligible
     * contributor. `guild_profile` is locked before the claim row (design 6).
     */
    async claimBounty(
        userId: string,
        bountyId: string,
        now = new Date(),
    ): Promise<ClaimGuildBountyResponseDto> {
        const found = await this.bountyRepository().findOneBy({ id: bountyId });
        if (!found) throw new NotFoundException("Community Bounty not found.");
        this.assertClaimable(found, now);

        const { receipt, pendingBadgeActivity } =
            await this.dataSource.transaction(async (manager) => {
                await this.lockProfile(manager, userId);
                const bounty = await this.bountyRepository(manager).findOneBy({
                    id: bountyId,
                });
                if (!bounty)
                    throw new NotFoundException("Community Bounty not found.");
                this.assertClaimable(bounty, now);

                const [claimRow]: Array<{ claimedMilestones: unknown }> =
                    await manager.query(
                        `SELECT claimedMilestones
                     FROM guild_community_bounty_claim
                     WHERE bountyId = ? AND profileUserId = ?
                     FOR UPDATE`,
                        [bountyId, userId],
                    );
                const claimedMilestones = parseClaimedMilestones(
                    claimRow?.claimedMilestones,
                );
                const [contribution]: Array<{ units: number | string }> =
                    await manager.query(
                        `SELECT COALESCE(SUM(units), 0) AS units
                     FROM guild_community_bounty_contribution
                     WHERE bountyId = ? AND profileUserId = ?`,
                        [bountyId, userId],
                    );
                const userContribution = Number(contribution?.units ?? 0);
                if (userContribution < bounty.minUserContribution) {
                    throw new ForbiddenException({
                        message:
                            "Contribute at least the bounty minimum before claiming.",
                        code: "guild_bounty_not_eligible",
                    });
                }

                const unlocked = GUILD_BOUNTY_MILESTONES.filter(
                    (milestone) =>
                        bounty.currentTotal * 100 >=
                        bounty.targetTotal * milestone,
                );
                const newlyClaimedMilestones = unlocked.filter(
                    (milestone) => !claimedMilestones.includes(milestone),
                );
                if (newlyClaimedMilestones.length === 0) {
                    throw new ConflictException({
                        message:
                            "There are no Community Bounty rewards to claim.",
                        code: "guild_bounty_nothing_to_claim",
                    });
                }

                const guildProfile = await manager
                    .getRepository(GuildProfile)
                    .findOneByOrFail({ profileUserId: userId });
                const rewards = parseMilestoneRewards(bounty.milestoneRewards);
                const unlockedRewards: GuildRewardDescriptorDto[] = [];
                const chestResults: GuildChestResultDto[] = [];
                const pendingBadgeActivity: GrantedTier[] = [];
                let sealsAwarded = 0;
                let xpAwarded = 0;

                for (const milestone of newlyClaimedMilestones) {
                    const config = rewards[String(milestone)] ?? {};
                    const referenceId = `bounty:${bountyId}:${milestone}`;
                    if (config.seals) {
                        await this.guildSealsService.creditSealsWithManager(
                            manager,
                            userId,
                            config.seals,
                            GuildSealReason.BOUNTY_CLAIM,
                            referenceId,
                        );
                        sealsAwarded += config.seals;
                    }
                    xpAwarded += config.xp ?? 0;

                    if (config.rewardId) {
                        const fulfillment =
                            await this.guildRewardsService.fulfillContractRewardWithManager(
                                manager,
                                userId,
                                referenceId,
                                config.rewardId,
                                now,
                                { sealReason: GuildSealReason.BOUNTY_CLAIM },
                            );
                        xpAwarded += fulfillment.bonusXp;
                        sealsAwarded += fulfillment.bonusSeals;
                        unlockedRewards.push(...fulfillment.unlockedRewards);
                        if (fulfillment.chestResult) {
                            chestResults.push(fulfillment.chestResult);
                        }
                        if (fulfillment.pendingBadgeActivity) {
                            pendingBadgeActivity.push(
                                fulfillment.pendingBadgeActivity,
                            );
                        }
                    }
                    if (config.chestKind) {
                        const chest =
                            await this.guildRewardsService.openChestWithManager(
                                manager,
                                userId,
                                config.chestKind,
                                referenceId,
                                now,
                                { sealReason: GuildSealReason.BOUNTY_CLAIM },
                            );
                        xpAwarded += chest.bonusXp;
                        sealsAwarded += chest.bonusSeals;
                        if (chest.unlockedCosmetic) {
                            unlockedRewards.push(chest.unlockedCosmetic);
                        }
                        chestResults.push(chest);
                    }
                }

                const rankBefore = guildProfile.rank;
                let rankAfter = rankBefore;
                let globalXpAwarded = 0;
                if (xpAwarded > 0) {
                    const xpAfter = guildProfile.xp + xpAwarded;
                    rankAfter = computeGuildRank(xpAfter).rank;
                    await manager.query(
                        "UPDATE guild_profile SET xp = ?, `rank` = ? WHERE profileUserId = ?",
                        [xpAfter, rankAfter, userId],
                    );
                    globalXpAwarded = Math.floor(
                        xpAwarded * GUILD_GLOBAL_XP_MULTIPLIER,
                    );
                    if (globalXpAwarded > 0) {
                        await this.levelService.increaseExp(
                            userId,
                            globalXpAwarded,
                            manager,
                        );
                    }
                    const updated = await manager
                        .getRepository(GuildProfile)
                        .findOneByOrFail({ profileUserId: userId });
                    await this.guildRankProgressionService.grantRankPromotionsWithManager(
                        manager,
                        updated,
                        bountyReference(bountyId),
                        now,
                    );
                    const prestige =
                        await this.guildRankProgressionService.grantPrestigeStarsWithManager(
                            manager,
                            updated,
                            bountyReference(bountyId),
                            now,
                        );
                    sealsAwarded += prestige.sealsAwarded;
                }

                const nextClaimedMilestones = [
                    ...claimedMilestones,
                    ...newlyClaimedMilestones,
                ].sort((a, b) => a - b);
                if (claimRow) {
                    await manager.query(
                        `UPDATE guild_community_bounty_claim
                     SET claimedMilestones = ?
                     WHERE bountyId = ? AND profileUserId = ?`,
                        [
                            JSON.stringify(nextClaimedMilestones),
                            bountyId,
                            userId,
                        ],
                    );
                } else {
                    await manager.query(
                        `INSERT INTO guild_community_bounty_claim
                        (bountyId, profileUserId, claimedMilestones)
                     VALUES (?, ?, ?)`,
                        [
                            bountyId,
                            userId,
                            JSON.stringify(nextClaimedMilestones),
                        ],
                    );
                }

                return {
                    receipt: {
                        bountyId,
                        claimedMilestones: nextClaimedMilestones,
                        newlyClaimedMilestones,
                        sealsAwarded,
                        xpAwarded,
                        globalXpAwarded,
                        rankBefore,
                        rankAfter,
                        unlockedRewards,
                        chestResults,
                    } satisfies ClaimGuildBountyResponseDto,
                    pendingBadgeActivity,
                };
            });

        for (const granted of pendingBadgeActivity) {
            try {
                this.achievementsProgressService?.registerGrantActivity(
                    userId,
                    granted,
                );
            } catch (error) {
                this.logger.error(
                    `Unable to register badge activity for user ${userId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        return receipt;
    }

    /**
     * Bounded scheduler sweep: at most `batchSize` eligible contributors get one
     * `guild.community-bounty-ready` intent, guarded by `notifiedReadyAt IS NULL`.
     */
    async fanOutReadyNotifications(
        now = new Date(),
        batchSize = GUILD_BOUNTY_NOTIFICATION_BATCH,
    ): Promise<number> {
        const bounties = await this.bountyRepository().find({
            where: {
                status: GuildBountyStatus.PUBLISHED,
                reached100At: Not(IsNull()),
                startsAt: LessThanOrEqual(now),
                endsAt: MoreThanOrEqual(
                    new Date(
                        now.getTime() - GUILD_BOUNTY_CLAIM_WINDOW_DAYS * DAY_MS,
                    ),
                ),
            },
            order: { reached100At: "ASC" },
        });

        let budget = Math.max(0, Math.floor(batchSize));
        let queued = 0;
        for (const bounty of bounties) {
            if (budget <= 0) break;
            const rows: Array<{ profileUserId: string }> =
                await this.dataSource.query(
                    `SELECT c.profileUserId AS profileUserId
                     FROM guild_community_bounty_contribution c
                     LEFT JOIN guild_community_bounty_claim cl
                       ON cl.bountyId = c.bountyId
                      AND cl.profileUserId = c.profileUserId
                     WHERE c.bountyId = ? AND cl.notifiedReadyAt IS NULL
                     GROUP BY c.profileUserId
                     HAVING SUM(c.units) >= ?
                     ORDER BY MIN(c.id) ASC
                     LIMIT ?`,
                    [bounty.id, bounty.minUserContribution, budget],
                );
            budget -= rows.length;
            for (const row of rows) {
                try {
                    queued += await this.notifyContributorOnce(
                        bounty.id,
                        row.profileUserId,
                        now,
                    );
                } catch (error) {
                    this.logger.warn(
                        `Guild bounty ready notification skipped for ${row.profileUserId}: ${
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }`,
                    );
                }
            }
        }
        return queued;
    }

    /** One transaction: create/lock the claim row, flip the marker, append the intent. */
    private async notifyContributorOnce(
        bountyId: string,
        userId: string,
        now: Date,
    ): Promise<number> {
        return this.dataSource.transaction(async (manager) => {
            await this.lockProfile(manager, userId);
            await manager.query(
                `INSERT IGNORE INTO guild_community_bounty_claim
                    (bountyId, profileUserId, claimedMilestones)
                 VALUES (?, ?, JSON_ARRAY())`,
                [bountyId, userId],
            );
            const result = await manager.query(
                `UPDATE guild_community_bounty_claim
                 SET notifiedReadyAt = ?
                 WHERE bountyId = ? AND profileUserId = ?
                   AND notifiedReadyAt IS NULL`,
                [now, bountyId, userId],
            );
            if (Number(result.affectedRows) !== 1) return 0;

            await appendNotificationIntent(manager, {
                eventType: "guild.community-bounty-ready",
                eventVersion: 1,
                occurredAt: now,
                recipientUserId: userId,
                actorUserId: null,
                payload: { bountyId },
            });
            return 1;
        });
    }

    private async recordContributionBatch(
        bounty: GuildCommunityBounty,
        userId: string,
        sourceKeys: string[],
        now: Date,
    ): Promise<number> {
        return this.dataSource.transaction(async (manager) => {
            await this.lockProfile(manager, userId);
            const [countRow]: Array<{ total: number | string }> =
                await manager.query(
                    `SELECT COUNT(*) AS total
                     FROM guild_community_bounty_contribution
                     WHERE bountyId = ? AND profileUserId = ?`,
                    [bounty.id, userId],
                );
            const existingRows: Array<{ sourceKey: string }> =
                await manager.query(
                    `SELECT sourceKey
                     FROM guild_community_bounty_contribution
                     WHERE bountyId = ? AND profileUserId = ?`,
                    [bounty.id, userId],
                );
            const existing = new Set(existingRows.map((row) => row.sourceKey));
            const remaining = Math.max(
                0,
                bounty.maxUserContributionCap - Number(countRow?.total ?? 0),
            );
            const newKeys = sourceKeys
                .filter((sourceKey) => !existing.has(sourceKey))
                .slice(0, remaining);
            if (newKeys.length === 0) return 0;

            const result = await manager.query(
                `INSERT IGNORE INTO guild_community_bounty_contribution
                    (bountyId, profileUserId, sourceKey, units, contributedAt)
                 VALUES ${newKeys.map(() => "(?, ?, ?, 1, ?)").join(", ")}`,
                newKeys.flatMap((sourceKey) => [
                    bounty.id,
                    userId,
                    sourceKey.slice(0, 128),
                    now,
                ]),
            );
            const inserted = Number(result.affectedRows ?? 0);
            if (inserted === 0) return 0;

            await manager.query(
                `UPDATE guild_community_bounty
                 SET currentTotal = currentTotal + ?,
                     reached100At = CASE
                         WHEN reached100At IS NULL
                          AND currentTotal + ? >= targetTotal
                         THEN ? ELSE reached100At END
                 WHERE id = ?`,
                [inserted, inserted, now, bounty.id],
            );
            return inserted;
        });
    }

    private evaluationContext(
        bounty: GuildCommunityBounty,
        userId: string,
        now: Date,
    ): GuildEvaluationContext {
        // Evaluators only read these contract fields; bounties own their window.
        const contract = {
            id: bounty.id,
            profileUserId: userId,
            objectiveType: bounty.objectiveType,
            criteria: bounty.criteria ?? {},
            targetGameId: null,
            acceptedAt: bounty.startsAt,
            expiresAt: bounty.endsAt,
        } as unknown as GuildContract;
        return {
            query: this.dataSource,
            contract,
            now,
            playtimeHistory: this.playtimeHistoryService,
            timeToBeat: this.guildTimeToBeatService,
        };
    }

    private toPlayerDto(
        bounty: GuildCommunityBounty,
        userContribution: number,
        claimedMilestones: number[],
        locale?: GuildLocale,
    ): GuildBountyDto {
        const translation =
            (locale
                ? bounty.translations?.find((entry) => entry.locale === locale)
                : null) ?? null;
        const rewards = parseMilestoneRewards(bounty.milestoneRewards);
        const eligible = userContribution >= bounty.minUserContribution;
        const claimed = new Set(claimedMilestones);
        const milestones: GuildBountyMilestoneStateDto[] =
            GUILD_BOUNTY_MILESTONES.map((milestone) => {
                const config = rewards[String(milestone)] ?? {};
                const unlocked =
                    bounty.currentTotal * 100 >= bounty.targetTotal * milestone;
                const isClaimed = claimed.has(milestone);
                return {
                    milestone,
                    unlocked,
                    claimed: isClaimed,
                    claimable: unlocked && !isClaimed && eligible,
                    sealsReward: config.seals ?? 0,
                    xpReward: config.xp ?? 0,
                    rewardId: config.rewardId ?? null,
                    chestKind: config.chestKind ?? null,
                };
            });

        return {
            id: bounty.id,
            slug: bounty.slug,
            title: translation?.title ?? bounty.title,
            description: translation?.description ?? bounty.description,
            objectiveType: bounty.objectiveType,
            targetTotal: bounty.targetTotal,
            currentTotal: bounty.currentTotal,
            progressPercent:
                bounty.targetTotal > 0
                    ? Math.floor(
                          (bounty.currentTotal * 100) / bounty.targetTotal,
                      )
                    : 0,
            startsAt: bounty.startsAt,
            endsAt: bounty.endsAt,
            status: bounty.status,
            userContribution,
            minUserContribution: bounty.minUserContribution,
            eligible,
            claimedMilestones: [...claimedMilestones].sort((a, b) => a - b),
            milestones,
            hasClaimableMilestones: milestones.some(
                (milestone) => milestone.claimable,
            ),
        };
    }

    private toAdminDto(
        bounty: GuildCommunityBounty,
    ): GuildAdminBountyResponseDto {
        return {
            id: bounty.id,
            slug: bounty.slug,
            title: bounty.title,
            description: bounty.description,
            objectiveType: bounty.objectiveType,
            criteria: bounty.criteria,
            targetTotal: bounty.targetTotal,
            currentTotal: bounty.currentTotal,
            minUserContribution: bounty.minUserContribution,
            maxUserContributionCap: bounty.maxUserContributionCap,
            milestoneRewards: parseMilestoneRewards(bounty.milestoneRewards),
            startsAt: bounty.startsAt,
            endsAt: bounty.endsAt,
            status: bounty.status,
            publishedAt: bounty.publishedAt,
            reached100At: bounty.reached100At,
            translations: [...(bounty.translations ?? [])]
                .sort((a, b) => a.locale.localeCompare(b.locale))
                .map(({ locale, title, description }) => ({
                    locale,
                    title,
                    description,
                })),
            createdAt: bounty.createdAt,
            updatedAt: bounty.updatedAt,
        };
    }

    private async findBountyOrFail(
        id: string,
        repository: Repository<GuildCommunityBounty> = this.bountyRepository(),
    ): Promise<GuildCommunityBounty> {
        const bounty = await repository.findOne({
            where: { id },
            relations: { translations: true },
        });
        if (!bounty) throw new NotFoundException("Community Bounty not found.");
        return bounty;
    }

    private async lockBounty(manager: EntityManager, id: string) {
        const [row]: Array<{ id: string }> = await manager.query(
            "SELECT id FROM guild_community_bounty WHERE id = ? FOR UPDATE",
            [id],
        );
        if (!row) throw new NotFoundException("Community Bounty not found.");
    }

    /** Race-safe lazy membership, then the design-6 `guild_profile` row lock. */
    private async lockProfile(manager: EntityManager, userId: string) {
        const [locked] = await manager.query(
            "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
        if (locked) return;
        await manager.query(
            "INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)",
            [userId],
        );
        await manager.query(
            "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
    }

    private assertClaimable(bounty: GuildCommunityBounty, now: Date) {
        if (
            bounty.status !== GuildBountyStatus.PUBLISHED ||
            bounty.startsAt > now ||
            now.getTime() >
                bounty.endsAt.getTime() +
                    GUILD_BOUNTY_CLAIM_WINDOW_DAYS * DAY_MS
        ) {
            throw claimWindowClosed();
        }
    }

    private assertWindow(startsAt: Date, endsAt: Date) {
        if (endsAt <= startsAt) badRequest("endsAt must be after startsAt.");
    }

    private assertContributionRules(
        targetTotal: number,
        minUserContribution: number,
        maxUserContributionCap: number,
    ) {
        if (!Number.isInteger(targetTotal) || targetTotal < 1) {
            badRequest("targetTotal must be an integer >= 1.");
        }
        if (!Number.isInteger(minUserContribution) || minUserContribution < 1) {
            badRequest("minUserContribution must be an integer >= 1.");
        }
        if (
            !Number.isInteger(maxUserContributionCap) ||
            maxUserContributionCap < minUserContribution
        ) {
            badRequest(
                "maxUserContributionCap must be an integer >= minUserContribution.",
            );
        }
    }

    private assertQuestRules(
        objectiveType: GuildObjectiveType,
        targetTotal: number,
        criteria: GuildCriteria,
    ) {
        const errors = validateGuildQuestRules(
            objectiveType,
            targetTotal,
            criteria,
        );
        if (errors.length > 0) {
            throw new BadRequestException({
                message: "Invalid quest rules.",
                errors,
            });
        }
    }

    private async assertRulesUnlocked(
        manager: EntityManager,
        id: string,
        saved: GuildCommunityBounty,
        dto: UpdateGuildBountyDto,
    ) {
        const [contribution]: Array<{ total: number | string }> =
            await manager.query(
                `SELECT COUNT(*) AS total
                 FROM guild_community_bounty_contribution
                 WHERE bountyId = ?`,
                [id],
            );
        if (
            Number(saved.currentTotal) <= 0 &&
            Number(contribution?.total ?? 0) <= 0
        ) {
            return;
        }

        const changed: string[] = [];
        if (
            dto.objectiveType !== undefined &&
            dto.objectiveType !== saved.objectiveType
        ) {
            changed.push("objectiveType");
        }
        if (
            dto.criteria !== undefined &&
            !isDeepStrictEqual(dto.criteria, saved.criteria)
        ) {
            changed.push("criteria");
        }
        if (
            dto.targetTotal !== undefined &&
            dto.targetTotal !== saved.targetTotal
        ) {
            changed.push("targetTotal");
        }
        if (
            dto.minUserContribution !== undefined &&
            dto.minUserContribution !== saved.minUserContribution
        ) {
            changed.push("minUserContribution");
        }
        if (
            dto.maxUserContributionCap !== undefined &&
            dto.maxUserContributionCap !== saved.maxUserContributionCap
        ) {
            changed.push("maxUserContributionCap");
        }
        if (
            dto.milestoneRewards !== undefined &&
            !isDeepStrictEqual(dto.milestoneRewards, saved.milestoneRewards)
        ) {
            changed.push("milestoneRewards");
        }
        if (
            dto.startsAt !== undefined &&
            dto.startsAt.getTime() !== saved.startsAt.getTime()
        ) {
            changed.push("startsAt");
        }
        if (changed.length > 0) throw new ConflictException(RULES_LOCKED);
    }

    private async assertSlugAvailable(slug: string) {
        if (await this.bountyRepository().existsBy({ slug })) {
            throw new ConflictException(
                "A bounty with this slug already exists.",
            );
        }
    }

    private async normalizeMilestoneRewards(
        manager: EntityManager,
        value: unknown,
    ): Promise<Record<string, GuildBountyMilestoneRewardDto>> {
        const normalized: Record<string, GuildBountyMilestoneRewardDto> = {};
        for (const milestone of GUILD_BOUNTY_MILESTONES) {
            normalized[String(milestone)] = {};
        }
        if (value == null) return normalized;
        if (typeof value !== "object" || Array.isArray(value)) {
            badRequest("milestoneRewards must be an object.");
        }

        const rewardIds = new Set<string>();
        for (const [key, raw] of Object.entries(value)) {
            if (!MILESTONE_KEYS.includes(key)) {
                badRequest(
                    `milestoneRewards.${key} is not a valid bounty milestone.`,
                );
            }
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                badRequest(`milestoneRewards.${key} must be an object.`);
            }
            const config = raw as Record<string, unknown>;
            for (const field of Object.keys(config)) {
                if (!["seals", "xp", "rewardId", "chestKind"].includes(field)) {
                    badRequest(
                        `milestoneRewards.${key}.${field} is not supported.`,
                    );
                }
            }
            const entry: GuildBountyMilestoneRewardDto = {};
            for (const field of ["seals", "xp"] as const) {
                const amount = config[field];
                if (amount === undefined) continue;
                if (!Number.isInteger(amount) || Number(amount) < 0) {
                    badRequest(
                        `milestoneRewards.${key}.${field} must be an integer >= 0.`,
                    );
                }
                entry[field] = amount as number;
            }
            if (config.rewardId !== undefined) {
                if (
                    typeof config.rewardId !== "string" ||
                    !config.rewardId.trim()
                ) {
                    badRequest(
                        `milestoneRewards.${key}.rewardId must be a Guild reward id.`,
                    );
                }
                entry.rewardId = config.rewardId.trim();
                rewardIds.add(entry.rewardId);
            }
            if (config.chestKind !== undefined) {
                if (
                    !CHEST_KINDS.includes(config.chestKind as GuildChestTierKey)
                ) {
                    badRequest(
                        `milestoneRewards.${key}.chestKind must be one of ${CHEST_KINDS.join(", ")}.`,
                    );
                }
                entry.chestKind = config.chestKind as GuildChestTierKey;
            }
            normalized[key] = entry;
        }

        if (rewardIds.size > 0) {
            const rewards = await manager.getRepository(GuildReward).find({
                where: { id: In([...rewardIds]) },
            });
            const byId = new Map(rewards.map((reward) => [reward.id, reward]));
            for (const rewardId of rewardIds) {
                const reward = byId.get(rewardId);
                if (!reward || !reward.isActive) {
                    badRequest(
                        `milestoneRewards rewardId ${rewardId} must reference an active Guild reward.`,
                    );
                }
            }
        }
        return normalized;
    }

    private validateTranslations(
        translations: GuildBountyTranslationDto[],
    ): GuildBountyTranslationDto[] {
        const locales = new Set<string>();
        const result = translations.map(({ locale, title, description }) => {
            if (locales.has(locale)) {
                badRequest("Duplicate translation locales are not allowed.");
            }
            locales.add(locale);
            return {
                locale,
                title: trimRequired(title, `translations.${locale}.title`),
                description: trimRequired(
                    description,
                    `translations.${locale}.description`,
                ),
            };
        });
        if (
            locales.size !== 2 ||
            !locales.has(GuildLocale.EN) ||
            !locales.has(GuildLocale.PT_BR)
        ) {
            badRequest("translations must include both en and pt-BR.");
        }
        return result;
    }

    private async insertTranslations(
        manager: EntityManager,
        bountyId: string,
        translations: GuildBountyTranslationDto[],
    ) {
        if (translations.length === 0) return;
        await manager.insert(
            GuildCommunityBountyTranslation,
            translations.map(({ locale, title, description }) => ({
                bountyId,
                locale,
                title,
                description,
            })),
        );
    }
}

/** Stable reference shared by milestone rewards within one claim. */
const bountyReference = (bountyId: string) => `bounty:${bountyId}`;
