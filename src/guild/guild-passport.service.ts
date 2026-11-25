import {
    BadRequestException,
    ConflictException,
    Injectable,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { LevelService } from "../level/level.service";
import {
    ClaimGuildPassportMilestoneResponseDto,
    GuildPassportMilestoneStatus,
    GuildPassportResponseDto,
    GuildPassportSummaryDto,
} from "./dto/guild-passport.dto";
import { GuildPassportMonth } from "./entities/guild-passport-month.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildRankProgressionService } from "./guild-rank-progression.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";
import {
    computeGuildRank,
    currentMonthKey,
    GUILD_GLOBAL_XP_MULTIPLIER,
    GuildChestTierKey,
    GuildConsumableKey,
    GuildRewardKind,
    GuildSealReason,
    nextMonthResetAt,
} from "./guild.constants";

export type GuildPassportStampResult = {
    monthKey: string;
    completedContractsCount: number;
};

export type GuildPassportMilestoneConfig = {
    milestone: number;
    chestKind: GuildChestTierKey;
    sealsReward: number;
    consumableKey: GuildConsumableKey | null;
    consumableQuantity: number;
};

/** 2, 4 and 6 claimed contracts per São Paulo month (spec: monthly passport). */
export const GUILD_PASSPORT_MILESTONES: readonly GuildPassportMilestoneConfig[] =
    [
        {
            milestone: 2,
            chestKind: GuildRewardKind.CHEST_BRONZE,
            sealsReward: 25,
            consumableKey: null,
            consumableQuantity: 0,
        },
        {
            milestone: 4,
            chestKind: GuildRewardKind.CHEST_SILVER,
            sealsReward: 50,
            consumableKey: null,
            consumableQuantity: 0,
        },
        {
            milestone: 6,
            chestKind: GuildRewardKind.CHEST_GOLD,
            sealsReward: 100,
            consumableKey: GuildConsumableKey.HOURGLASS,
            consumableQuantity: 1,
        },
    ];

const parseClaimedMilestones = (value: unknown): number[] => {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is number =>
            Number.isInteger(entry),
        );
    }
    if (typeof value !== "string") return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((entry): entry is number => Number.isInteger(entry))
            : [];
    } catch {
        return [];
    }
};

/**
 * Monthly Guild Passport stamp tracking and milestone claims (design 8).
 * Every write acquires `guild_profile` then `guild_passport_month`, per design 6.
 */
@Injectable()
export class GuildPassportService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly guildRewardsService: GuildRewardsService,
        private readonly guildSealsService: GuildSealsService,
        private readonly guildRankProgressionService: GuildRankProgressionService,
        private readonly levelService: LevelService,
    ) {}

    /**
     * Called by `GuildContractsService.claimContract` inside its transaction,
     * after the `guild_profile` lock: one atomic São Paulo month stamp.
     */
    public async recordContractCompletionWithManager(
        manager: EntityManager,
        userId: string,
        claimedAt = new Date(),
    ): Promise<GuildPassportStampResult> {
        const monthKey = currentMonthKey(claimedAt);
        await this.lockProfile(manager, userId);
        await manager.query(
            `INSERT INTO guild_passport_month (profileUserId, monthKey, completedContractsCount, claimedMilestones)
             VALUES (?, ?, 1, JSON_ARRAY())
             ON DUPLICATE KEY UPDATE completedContractsCount = completedContractsCount + 1`,
            [userId, monthKey],
        );
        const [row] = await manager.query(
            "SELECT completedContractsCount FROM guild_passport_month WHERE profileUserId = ? AND monthKey = ?",
            [userId, monthKey],
        );
        return {
            monthKey,
            completedContractsCount: Number(row.completedContractsCount),
        };
    }

    public async getPassport(
        userId: string,
        now = new Date(),
    ): Promise<GuildPassportResponseDto> {
        const monthKey = currentMonthKey(now);
        const month = await this.dataSource
            .getRepository(GuildPassportMonth)
            .findOneBy({ profileUserId: userId, monthKey });
        const completedContractsCount = month?.completedContractsCount ?? 0;
        const claimed = new Set(
            parseClaimedMilestones(month?.claimedMilestones),
        );

        return {
            monthKey,
            completedContractsCount,
            resetsAt: nextMonthResetAt(now),
            milestones: GUILD_PASSPORT_MILESTONES.map((config) => ({
                milestone: config.milestone,
                status: claimed.has(config.milestone)
                    ? GuildPassportMilestoneStatus.CLAIMED
                    : completedContractsCount >= config.milestone
                      ? GuildPassportMilestoneStatus.CLAIMABLE
                      : GuildPassportMilestoneStatus.LOCKED,
                chestKind: config.chestKind,
                sealsReward: config.sealsReward,
                consumableKey: config.consumableKey,
                consumableQuantity: config.consumableKey
                    ? config.consumableQuantity
                    : 0,
            })),
        };
    }

    /** Lightweight `GET /v1/guild` overview summary. */
    public async getPassportSummary(
        userId: string,
        now = new Date(),
    ): Promise<GuildPassportSummaryDto> {
        const passport = await this.getPassport(userId, now);
        return {
            monthKey: passport.monthKey,
            completedContractsCount: passport.completedContractsCount,
            claimableMilestones: passport.milestones
                .filter(
                    ({ status }) =>
                        status === GuildPassportMilestoneStatus.CLAIMABLE,
                )
                .map(({ milestone }) => milestone),
        };
    }

    public async claimMilestone(
        userId: string,
        milestone: number,
        now = new Date(),
    ): Promise<ClaimGuildPassportMilestoneResponseDto> {
        const config = GUILD_PASSPORT_MILESTONES.find(
            (entry) => entry.milestone === milestone,
        );
        if (!config) {
            throw new BadRequestException({
                message: "Guild Passport milestones are 2, 4 and 6.",
                code: "guild_passport_invalid_milestone",
            });
        }

        const monthKey = currentMonthKey(now);
        const referenceId = `passport:${monthKey}:${milestone}`;

        return this.dataSource.transaction(async (manager) => {
            await this.lockProfile(manager, userId);
            const [month] = await manager.query(
                `SELECT completedContractsCount, claimedMilestones
                 FROM guild_passport_month
                 WHERE profileUserId = ? AND monthKey = ?
                 FOR UPDATE`,
                [userId, monthKey],
            );
            const completedContractsCount = Number(
                month?.completedContractsCount ?? 0,
            );
            const claimedMilestones = parseClaimedMilestones(
                month?.claimedMilestones,
            );
            if (completedContractsCount < milestone) {
                throw new ConflictException({
                    message: `Finish ${milestone} Guild contracts this month first.`,
                    code: "guild_passport_milestone_not_reached",
                });
            }
            if (claimedMilestones.includes(milestone)) {
                throw new ConflictException({
                    message:
                        "This Guild Passport milestone was already claimed.",
                    code: "guild_passport_milestone_already_claimed",
                });
            }

            const guildProfile = await manager
                .getRepository(GuildProfile)
                .findOneByOrFail({ profileUserId: userId });
            const chestResult =
                await this.guildRewardsService.openChestWithManager(
                    manager,
                    userId,
                    config.chestKind,
                    referenceId,
                    now,
                );
            if (config.sealsReward > 0) {
                await this.guildSealsService.creditSealsWithManager(
                    manager,
                    userId,
                    config.sealsReward,
                    GuildSealReason.PASSPORT_CLAIM,
                    referenceId,
                );
            }
            if (config.consumableKey) {
                await this.guildSealsService.grantConsumableWithManager(
                    manager,
                    userId,
                    config.consumableKey,
                    config.consumableQuantity,
                );
            }

            const nextClaimedMilestones = [
                ...claimedMilestones,
                milestone,
            ].sort((a, b) => a - b);
            await manager.query(
                "UPDATE guild_passport_month SET claimedMilestones = ? WHERE profileUserId = ? AND monthKey = ?",
                [JSON.stringify(nextClaimedMilestones), userId, monthKey],
            );

            const rankBefore = guildProfile.rank;
            const xpAwarded = chestResult.bonusXp;
            let rankAfter = rankBefore;
            let globalXpAwarded = 0;
            let prestigeSealsAwarded = 0;
            if (xpAwarded > 0) {
                // Chest XP follows the contract-claim pipeline: Guild XP, rank,
                // then Rank packages and Prestige stars.
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
                    referenceId,
                    now,
                );
                const prestige =
                    await this.guildRankProgressionService.grantPrestigeStarsWithManager(
                        manager,
                        updated,
                        referenceId,
                        now,
                    );
                prestigeSealsAwarded = prestige.sealsAwarded;
            }

            const receipt = {
                monthKey,
                milestone,
                claimedMilestones: nextClaimedMilestones,
                completedContractsCount,
                chestResult,
                sealsAwarded:
                    config.sealsReward +
                    chestResult.bonusSeals +
                    prestigeSealsAwarded,
                consumableKey: config.consumableKey,
                consumableQuantity: config.consumableKey
                    ? config.consumableQuantity
                    : 0,
                xpAwarded,
                globalXpAwarded,
                rankBefore,
                rankAfter,
            } satisfies ClaimGuildPassportMilestoneResponseDto;

            return receipt;
        });
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
}
