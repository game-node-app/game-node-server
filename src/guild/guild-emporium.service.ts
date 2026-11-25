import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, EntityManager, In } from "typeorm";
import {
    AchievementsProgressService,
    GrantedTier,
} from "../achievements/achievements-progress.service";
import { AchievementStatus } from "../achievements/achievements.constants";
import { AchievementDefinition } from "../achievements/entities/achievement-definition.entity";
import { ObtainedAchievement } from "../achievements/entities/obtained-achievement.entity";
import {
    CreateGuildEmporiumItemDto,
    GuildAdminEmporiumItemResponseDto,
    GuildEmporiumListingDto,
    GuildEmporiumPurchaseResponseDto,
    GuildEmporiumResponseDto,
    GuildExtraSlotPermitStatusDto,
    PurchaseGuildEmporiumItemDto,
    UpdateGuildEmporiumItemDto,
} from "./dto/guild-emporium.dto";
import {
    GuildChestResultDto,
    GuildConsumableBalancesDto,
} from "./dto/guild-rewards.dto";
import { GuildEmporiumItem } from "./entities/guild-emporium-item.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { UserGuildReward } from "./entities/user-guild-reward.entity";
import {
    GuildConsumableKey,
    GuildRank,
    GuildRewardKind,
    GuildSealReason,
    currentMonthKey,
    currentWeekStart,
    guildRankAtLeast,
    nextMondayRefreshAt,
    nextMonthResetAt,
    seededOrder,
    toRewardDescriptor,
} from "./guild.constants";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";

/** How many of the rotating pool are shown each São Paulo month. */
const ROTATING_SHOWCASE_SIZE = 6;

/** Rewards that stack in inventory instead of unlocking once. */
const REPEATABLE_REWARD_KINDS = new Set<GuildRewardKind>([
    GuildRewardKind.CONSUMABLE,
    GuildRewardKind.WEEKLY_CHEST,
    GuildRewardKind.CHEST_BRONZE,
    GuildRewardKind.CHEST_SILVER,
    GuildRewardKind.CHEST_GOLD,
    GuildRewardKind.CHEST_RELIC,
]);

const alreadyOwned = () =>
    new ConflictException({
        message: "You already own this Emporium reward.",
        code: "guild_emporium_already_owned",
    });

/**
 * Lina's Emporium: the permanent shelf, the deterministic monthly rotating
 * showcase, atomic Seals purchases and Extra Slot Permit activation (design 8).
 */
@Injectable()
export class GuildEmporiumService {
    private readonly logger = new Logger(GuildEmporiumService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly sealsService: GuildSealsService,
        private readonly rewardsService: GuildRewardsService,
        private readonly achievementsProgressService: AchievementsProgressService,
    ) {}

    async getEmporium(
        userId: string,
        now = new Date(),
    ): Promise<GuildEmporiumResponseDto> {
        const monthKey = currentMonthKey(now);
        const [profile, items, purchaseRows] = await Promise.all([
            this.dataSource
                .getRepository(GuildProfile)
                .findOneBy({ profileUserId: userId }),
            this.dataSource.getRepository(GuildEmporiumItem).find({
                where: { isActive: true },
                relations: { reward: true },
            }),
            this.dataSource.query(
                `SELECT emporiumItemId, COUNT(*) AS purchases
                 FROM guild_emporium_purchase
                 WHERE profileUserId = ? AND monthKey = ?
                 GROUP BY emporiumItemId`,
                [userId, monthKey],
            ),
        ]);
        const purchasesByItem = new Map<string, number>(
            (
                purchaseRows as Array<{
                    emporiumItemId: string;
                    purchases: number | string;
                }>
            ).map((row) => [row.emporiumItemId, Number(row.purchases)]),
        );

        const permanentItems = items
            .filter((item) => !item.isRotating)
            .sort(
                (a, b) =>
                    a.priceSeals - b.priceSeals || a.id.localeCompare(b.id),
            );
        const rotatingItems = this.showcaseOrder(
            monthKey,
            items.filter((item) => item.isRotating),
        );
        const ownedRewardIds = await this.readOwnedRewardIds(
            userId,
            [...permanentItems, ...rotatingItems].map((item) => item.reward),
        );
        const rank = profile?.rank ?? GuildRank.E;
        const sealsBalance = profile?.sealsBalance ?? 0;

        const toListing = (
            item: GuildEmporiumItem,
        ): GuildEmporiumListingDto => {
            const purchasedThisMonth = purchasesByItem.get(item.id) ?? 0;
            const owned =
                !REPEATABLE_REWARD_KINDS.has(item.reward.kind) &&
                ownedRewardIds.has(item.rewardId);
            return {
                id: item.id,
                priceSeals: item.priceSeals,
                minRank: item.minRank,
                isRotating: item.isRotating,
                reward: toRewardDescriptor(item.reward),
                maxPurchasesPerMonth: item.maxPurchasesPerMonth,
                owned,
                purchasedThisMonth,
                canPurchase:
                    !owned &&
                    (item.maxPurchasesPerMonth == null ||
                        purchasedThisMonth < item.maxPurchasesPerMonth) &&
                    guildRankAtLeast(rank, item.minRank) &&
                    sealsBalance >= item.priceSeals,
            };
        };

        return {
            sealsBalance,
            monthKey,
            nextRotationAt: nextMonthResetAt(now),
            permanentItems: permanentItems.map(toListing),
            rotatingItems: rotatingItems.map(toListing),
        };
    }

    async purchase(
        userId: string,
        dto: PurchaseGuildEmporiumItemDto,
        now = new Date(),
    ): Promise<GuildEmporiumPurchaseResponseDto> {
        const monthKey = currentMonthKey(now);
        const outcome = await this.dataSource.transaction(async (manager) => {
            // Design 6 lock order: guild_profile first, then the Emporium listing.
            const profile = await this.lockProfile(manager, userId);
            const [lockedItem]: Array<{ id: string }> = await manager.query(
                "SELECT id FROM guild_emporium_item WHERE id = ? FOR UPDATE",
                [dto.emporiumItemId],
            );
            if (!lockedItem)
                throw new NotFoundException("Emporium item not found.");
            const item = await manager
                .getRepository(GuildEmporiumItem)
                .findOne({
                    where: { id: dto.emporiumItemId },
                    relations: { reward: true },
                });
            if (!item || !item.isActive) {
                throw new NotFoundException("Emporium item not found.");
            }
            if (
                item.isRotating &&
                !(await this.isInMonthlyShowcase(manager, item.id, monthKey))
            ) {
                throw new NotFoundException("Emporium item not found.");
            }

            if (!guildRankAtLeast(profile.rank, item.minRank)) {
                throw new ForbiddenException({
                    message: "This Emporium item requires a higher Guild rank.",
                    code: "guild_emporium_rank_required",
                });
            }
            if (
                !REPEATABLE_REWARD_KINDS.has(item.reward.kind) &&
                (await this.isRewardOwned(manager, userId, item.reward))
            ) {
                throw alreadyOwned();
            }
            if (item.maxPurchasesPerMonth != null) {
                const [{ purchases }]: Array<{ purchases: number | string }> =
                    await manager.query(
                        `SELECT COUNT(*) AS purchases FROM guild_emporium_purchase
                         WHERE profileUserId = ? AND emporiumItemId = ? AND monthKey = ?`,
                        [userId, item.id, monthKey],
                    );
                if (Number(purchases) >= item.maxPurchasesPerMonth) {
                    throw new ConflictException({
                        message:
                            "Monthly purchase limit reached for this Emporium item.",
                        code: "guild_emporium_monthly_limit_reached",
                    });
                }
            }

            // Debits under the same profile lock; insufficient Seals throw 409 and roll back.
            const sealsBalance = await this.sealsService.debitSealsWithManager(
                manager,
                userId,
                item.priceSeals,
                GuildSealReason.EMPORIUM_PURCHASE,
                item.id,
            );
            const purchase: { insertId: number } = await manager.query(
                `INSERT INTO guild_emporium_purchase
                 (profileUserId, emporiumItemId, monthKey, priceSeals, purchasedAt)
                 VALUES (?, ?, ?, ?, ?)`,
                [userId, item.id, monthKey, item.priceSeals, now],
            );
            const grant = await this.grantRewardWithManager(
                manager,
                userId,
                item.reward,
                `emporium:${purchase.insertId}`,
                now,
            );

            return {
                // The chest payout lands after the debit read, so add it back.
                sealsBalance:
                    sealsBalance + (grant.chestResult?.bonusSeals ?? 0),
                priceSeals: item.priceSeals,
                reward: toRewardDescriptor(item.reward),
                chestResult: grant.chestResult,
                pendingBadgeActivity: grant.pendingBadgeActivity,
                consumables: await this.sealsService.getConsumableBalances(
                    userId,
                    manager,
                ),
            };
        });

        if (outcome.pendingBadgeActivity) {
            try {
                this.achievementsProgressService.registerGrantActivity(
                    userId,
                    outcome.pendingBadgeActivity,
                );
            } catch (error) {
                this.logger.error(
                    `Unable to register badge activity for user ${userId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        return {
            itemId: dto.emporiumItemId,
            priceSeals: outcome.priceSeals,
            sealsBalance: outcome.sealsBalance,
            reward: outcome.reward,
            chestResult: outcome.chestResult,
            consumables: {
                ...outcome.consumables,
            } as GuildConsumableBalancesDto,
        };
    }

    async activateExtraSlotPermit(
        userId: string,
        now = new Date(),
    ): Promise<GuildExtraSlotPermitStatusDto> {
        const weekStart = currentWeekStart(now);
        return this.dataSource.transaction(async (manager) => {
            const profile = await this.lockProfile(manager, userId);
            if (profile.extraSlotPermitWeekStart === weekStart) {
                throw new ConflictException({
                    message:
                        "An Extra Slot Permit is already active this week.",
                    code: "guild_permit_already_active",
                });
            }
            const remainingPermits =
                await this.sealsService.consumeConsumableWithManager(
                    manager,
                    userId,
                    GuildConsumableKey.EXTRA_SLOT_PERMIT,
                    1,
                );
            await manager.query(
                "UPDATE guild_profile SET extraSlotPermitWeekStart = ? WHERE profileUserId = ?",
                [weekStart, userId],
            );
            return {
                weekStart,
                activeThisWeek: true,
                expiresAt: nextMondayRefreshAt(weekStart),
                remainingPermits,
            };
        });
    }

    async listAdminItems(): Promise<GuildAdminEmporiumItemResponseDto[]> {
        const items = await this.dataSource
            .getRepository(GuildEmporiumItem)
            .find({
                relations: { reward: true },
                order: { createdAt: "DESC" },
            });
        return items.map((item) => this.toAdminDto(item));
    }

    async createAdminItem(
        dto: CreateGuildEmporiumItemDto,
    ): Promise<GuildAdminEmporiumItemResponseDto> {
        this.assertPrice(dto.priceSeals);
        this.assertMaxPurchases(dto.maxPurchasesPerMonth ?? null);
        await this.findListableReward(dto.rewardId);

        const item = await this.dataSource
            .getRepository(GuildEmporiumItem)
            .save({
                id: randomUUID(),
                rewardId: dto.rewardId,
                priceSeals: dto.priceSeals,
                minRank: dto.minRank ?? GuildRank.E,
                isRotating: dto.isRotating ?? false,
                maxPurchasesPerMonth: dto.maxPurchasesPerMonth ?? null,
                isActive: dto.isActive ?? true,
            });
        return this.findAdminItemOrFail(item.id);
    }

    async updateAdminItem(
        id: string,
        dto: UpdateGuildEmporiumItemDto,
    ): Promise<GuildAdminEmporiumItemResponseDto> {
        if (dto.priceSeals !== undefined) this.assertPrice(dto.priceSeals);
        if (dto.maxPurchasesPerMonth !== undefined) {
            this.assertMaxPurchases(dto.maxPurchasesPerMonth);
        }
        if (dto.rewardId !== undefined) {
            await this.findListableReward(dto.rewardId);
        }

        await this.dataSource.transaction(async (manager) => {
            // Locks the listing so a purchase cannot land mid-edit.
            const [locked]: Array<{ id: string }> = await manager.query(
                "SELECT id FROM guild_emporium_item WHERE id = ? FOR UPDATE",
                [id],
            );
            if (!locked)
                throw new NotFoundException("Emporium item not found.");

            const changes: Partial<GuildEmporiumItem> = {};
            if (dto.rewardId !== undefined) changes.rewardId = dto.rewardId;
            if (dto.priceSeals !== undefined) {
                changes.priceSeals = dto.priceSeals;
            }
            if (dto.minRank !== undefined) changes.minRank = dto.minRank;
            if (dto.isRotating !== undefined) {
                changes.isRotating = dto.isRotating;
            }
            if (dto.maxPurchasesPerMonth !== undefined) {
                changes.maxPurchasesPerMonth = dto.maxPurchasesPerMonth;
            }
            if (dto.isActive !== undefined) changes.isActive = dto.isActive;
            if (Object.keys(changes).length > 0) {
                await manager.update(GuildEmporiumItem, { id }, changes);
            }
        });
        return this.findAdminItemOrFail(id);
    }

    /** `seededOrder(sha256("emporium:" + monthKey), rotatingPool, id)`, first 6. */
    private showcaseOrder<T extends { id: string }>(
        monthKey: string,
        rotatingPool: readonly T[],
    ): T[] {
        return seededOrder(
            createHash("sha256").update(`emporium:${monthKey}`).digest(),
            rotatingPool,
            (item) => item.id,
        ).slice(0, ROTATING_SHOWCASE_SIZE);
    }

    private async isInMonthlyShowcase(
        manager: EntityManager,
        itemId: string,
        monthKey: string,
    ): Promise<boolean> {
        const rotatingPool: Array<{ id: string }> = await manager.query(
            "SELECT id FROM guild_emporium_item WHERE isRotating = 1 AND isActive = 1",
        );
        return this.showcaseOrder(monthKey, rotatingPool).some(
            (item) => item.id === itemId,
        );
    }

    private async readOwnedRewardIds(
        userId: string,
        rewards: readonly GuildReward[],
    ): Promise<Set<string>> {
        if (rewards.length === 0) return new Set();
        const achievementIds = rewards
            .filter(
                (reward) =>
                    reward.kind === GuildRewardKind.BADGE &&
                    reward.achievementId,
            )
            .map((reward) => reward.achievementId as string);
        const [unlocked, obtained] = await Promise.all([
            this.dataSource.getRepository(UserGuildReward).find({
                where: { profileUserId: userId },
                select: { rewardId: true },
            }),
            achievementIds.length > 0
                ? this.dataSource.getRepository(ObtainedAchievement).find({
                      where: {
                          profileUserId: userId,
                          achievementId: In(achievementIds),
                      },
                      select: { achievementId: true },
                  })
                : [],
        ]);
        const obtainedIds = new Set(obtained.map((row) => row.achievementId));
        const owned = new Set(unlocked.map((row) => row.rewardId));
        for (const reward of rewards) {
            if (
                reward.kind === GuildRewardKind.BADGE &&
                reward.achievementId &&
                obtainedIds.has(reward.achievementId)
            ) {
                owned.add(reward.id);
            }
        }
        return owned;
    }

    private async isRewardOwned(
        manager: EntityManager,
        userId: string,
        reward: GuildReward,
    ): Promise<boolean> {
        if (reward.kind === GuildRewardKind.BADGE) {
            return (
                !!reward.achievementId &&
                (await manager.getRepository(ObtainedAchievement).existsBy({
                    profileUserId: userId,
                    achievementId: reward.achievementId,
                }))
            );
        }
        return manager.getRepository(UserGuildReward).existsBy({
            profileUserId: userId,
            rewardId: reward.id,
        });
    }

    private async grantRewardWithManager(
        manager: EntityManager,
        userId: string,
        reward: GuildReward,
        sourceId: string,
        now: Date,
    ): Promise<{
        chestResult: GuildChestResultDto | null;
        pendingBadgeActivity: GrantedTier | null;
    }> {
        switch (reward.kind) {
            case GuildRewardKind.CONSUMABLE: {
                if (!reward.consumableKey) {
                    throw this.unavailableListing();
                }
                await this.sealsService.grantConsumableWithManager(
                    manager,
                    userId,
                    reward.consumableKey,
                    1,
                );
                break;
            }
            case GuildRewardKind.BADGE: {
                if (!reward.achievementId) throw this.unavailableListing();
                const definition = await manager
                    .getRepository(AchievementDefinition)
                    .findOne({
                        where: { id: reward.achievementId },
                        relations: { tiers: true },
                    });
                if (definition?.status !== AchievementStatus.PUBLISHED) {
                    throw this.unavailableListing();
                }
                const granted =
                    await this.achievementsProgressService.grantTiersWithManager(
                        manager,
                        userId,
                        definition,
                        [1],
                        "live",
                    );
                if (!granted) throw alreadyOwned();
                return {
                    chestResult: null,
                    pendingBadgeActivity: granted,
                };
            }
            case GuildRewardKind.TITLE:
            case GuildRewardKind.AVATAR_FRAME:
            case GuildRewardKind.LICENSE_THEME:
            case GuildRewardKind.STAMP_STYLE:
            case GuildRewardKind.TAVERN_DECOR: {
                const inserted = await manager.query(
                    "INSERT IGNORE INTO user_guild_reward (profileUserId, rewardId, sourceContractId, unlockedAt) VALUES (?, ?, ?, ?)",
                    [userId, reward.id, null, now],
                );
                if (inserted.affectedRows !== 1) throw alreadyOwned();
                break;
            }
            case GuildRewardKind.WEEKLY_CHEST:
            case GuildRewardKind.CHEST_BRONZE:
            case GuildRewardKind.CHEST_SILVER:
            case GuildRewardKind.CHEST_GOLD:
            case GuildRewardKind.CHEST_RELIC: {
                const chestResult =
                    await this.rewardsService.openChestWithManager(
                        manager,
                        userId,
                        reward.kind,
                        sourceId,
                        now,
                    );
                return { chestResult, pendingBadgeActivity: null };
            }
        }
        return { chestResult: null, pendingBadgeActivity: null };
    }

    private unavailableListing() {
        return new BadRequestException(
            "This Emporium listing cannot grant its reward.",
        );
    }

    /**
     * Race-safe lazy membership plus the design-6 `guild_profile` row lock.
     * The upsert takes the exclusive lock for both first-time and repeat buyers,
     * where INSERT IGNORE would hold a shared lock and deadlock on the upgrade.
     */
    private async lockProfile(
        manager: EntityManager,
        userId: string,
    ): Promise<GuildProfile> {
        await manager.query(
            `INSERT INTO guild_profile (profileUserId) VALUES (?)
             ON DUPLICATE KEY UPDATE profileUserId = ?`,
            [userId, userId],
        );
        return manager.getRepository(GuildProfile).findOneOrFail({
            where: { profileUserId: userId },
            lock: { mode: "pessimistic_write" },
        });
    }

    private async findAdminItemOrFail(
        id: string,
    ): Promise<GuildAdminEmporiumItemResponseDto> {
        const item = await this.dataSource
            .getRepository(GuildEmporiumItem)
            .findOne({ where: { id }, relations: { reward: true } });
        if (!item) throw new NotFoundException("Emporium item not found.");
        return this.toAdminDto(item);
    }

    private toAdminDto(
        item: GuildEmporiumItem,
    ): GuildAdminEmporiumItemResponseDto {
        return {
            id: item.id,
            reward: toRewardDescriptor(item.reward),
            priceSeals: item.priceSeals,
            minRank: item.minRank,
            isRotating: item.isRotating,
            maxPurchasesPerMonth: item.maxPurchasesPerMonth,
            isActive: item.isActive,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        };
    }

    private async findListableReward(rewardId: string): Promise<GuildReward> {
        const reward = await this.dataSource
            .getRepository(GuildReward)
            .findOneBy({ id: rewardId });
        if (!reward) {
            throw new BadRequestException(
                "rewardId must reference an existing Guild reward.",
            );
        }
        if (
            reward.kind === GuildRewardKind.CONSUMABLE &&
            !reward.consumableKey
        ) {
            throw new BadRequestException(
                "A consumable listing requires a reward with a consumableKey.",
            );
        }
        if (reward.kind === GuildRewardKind.BADGE && !reward.achievementId) {
            throw new BadRequestException(
                "A badge listing requires a reward with an achievementId.",
            );
        }
        return reward;
    }

    private assertPrice(priceSeals: number) {
        if (!Number.isInteger(priceSeals) || priceSeals < 1) {
            throw new BadRequestException(
                "priceSeals must be a positive integer.",
            );
        }
    }

    private assertMaxPurchases(maxPurchasesPerMonth: number | null) {
        if (
            maxPurchasesPerMonth != null &&
            (!Number.isInteger(maxPurchasesPerMonth) ||
                maxPurchasesPerMonth < 1)
        ) {
            throw new BadRequestException(
                "maxPurchasesPerMonth must be a positive integer or null.",
            );
        }
    }
}
