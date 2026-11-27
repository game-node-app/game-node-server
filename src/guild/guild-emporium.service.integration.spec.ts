import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { Profile } from "../profile/entities/profile.entity";
import { EUserRoles } from "../utils/constants";
import { GuildAdminController } from "./guild-admin.controller";
import { GuildEmporiumItem } from "./entities/guild-emporium-item.entity";
import { GuildEmporiumPurchase } from "./entities/guild-emporium-purchase.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { UserGuildReward } from "./entities/user-guild-reward.entity";
import {
    GuildConsumableKey,
    GuildRank,
    GuildRewardKind,
    GuildRewardRarity,
    currentMonthKey,
    currentWeekStart,
    nextMondayRefreshAt,
    nextMonthResetAt,
    seededOrder,
} from "./guild.constants";
import { GuildEmporiumService } from "./guild-emporium.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";

const rejectionOf = (promise: Promise<unknown>) =>
    promise.then(
        () => null,
        (error) => error,
    );

/** Fixed instant so the São Paulo month/week are stable across runs. */
const NOW = new Date("2026-11-15T12:00:00Z");
const MONTH_KEY = currentMonthKey(NOW);
const WEEK_START = currentWeekStart(NOW);

describe("GuildEmporiumService (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_emporium_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let source: DataSource;
    let seals: GuildSealsService;
    let service: GuildEmporiumService;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;
        seals = new GuildSealsService(source);
        const achievements = new AchievementsProgressService(
            source,
            new LevelService(source.getRepository(UserLevel)),
            { register: jest.fn() } as any,
        );
        const rewards = new GuildRewardsService(source, achievements, seals);
        service = new GuildEmporiumService(
            source,
            seals,
            rewards,
            achievements,
        );

        // The test schema is synchronized from entities, so the migration seeds are
        // recreated here: 8 rotating items keep one out of the 6-item showcase.
        for (let index = 0; index < 8; index++) {
            const rewardId = await seedReward(
                `seasonal_${index}`,
                GuildRewardKind.LICENSE_THEME,
            );
            await seedItem(rewardId, { isRotating: true, priceSeals: 100 });
        }
    });

    afterAll(async () => {
        await db?.destroy();
    });

    async function seedReward(
        key: string,
        kind: GuildRewardKind,
        overrides: Partial<GuildReward> = {},
    ): Promise<string> {
        const id = randomUUID();
        await source.getRepository(GuildReward).insert({
            id,
            key,
            kind,
            achievementId: null,
            inChestPool: false,
            chestBonusXp: 0,
            chestBonusSeals: 0,
            rarity: GuildRewardRarity.COMMON,
            consumableKey: null,
            isActive: true,
            ...overrides,
        });
        return id;
    }

    async function seedItem(
        rewardId: string,
        overrides: Partial<GuildEmporiumItem> = {},
    ): Promise<string> {
        const id = randomUUID();
        await source.getRepository(GuildEmporiumItem).insert({
            id,
            rewardId,
            priceSeals: 100,
            minRank: GuildRank.E,
            isRotating: false,
            maxPurchasesPerMonth: null,
            isActive: true,
            ...overrides,
        });
        return id;
    }

    async function createMember(
        overrides: Partial<GuildProfile> = {},
    ): Promise<string> {
        const userId = randomUUID();
        await source.getRepository(Profile).insert({
            userId,
            username: `g${userId.slice(0, 18)}`,
        });
        await source.getRepository(GuildProfile).insert({
            profileUserId: userId,
            ...overrides,
        });
        return userId;
    }

    const profileOf = (userId: string) =>
        source
            .getRepository(GuildProfile)
            .findOneByOrFail({ profileUserId: userId });

    const permanentListing = async (userId: string, itemId: string) =>
        (await service.getEmporium(userId, NOW)).permanentItems.find(
            (listing) => listing.id === itemId,
        );

    const activeRotatingPool = () =>
        source
            .getRepository(GuildEmporiumItem)
            .find({ where: { isRotating: true, isActive: true } });

    describe("monthly showcase", () => {
        it("returns the same deterministic 6-item showcase to every user with personalized state", async () => {
            const buyer = await createMember({
                rank: GuildRank.S,
                sealsBalance: 1_000,
            });
            const newcomer = await createMember({
                rank: GuildRank.E,
                sealsBalance: 0,
            });

            const [buyerView, newcomerView] = await Promise.all([
                service.getEmporium(buyer, NOW),
                service.getEmporium(newcomer, NOW),
            ]);

            expect(buyerView.monthKey).toBe(MONTH_KEY);
            expect(buyerView.nextRotationAt).toEqual(nextMonthResetAt(NOW));
            expect(buyerView.sealsBalance).toBe(1_000);
            expect(buyerView.rotatingItems).toHaveLength(6);
            expect(buyerView.rotatingItems.map((item) => item.id)).toEqual(
                newcomerView.rotatingItems.map((item) => item.id),
            );

            const pool = await activeRotatingPool();
            const expected = seededOrder(
                createHash("sha256").update(`emporium:${MONTH_KEY}`).digest(),
                pool,
                (item) => item.id,
            )
                .slice(0, 6)
                .map((item) => item.id);
            expect(buyerView.rotatingItems.map((item) => item.id)).toEqual(
                expected,
            );

            const first = buyerView.rotatingItems[0];
            await source.getRepository(UserGuildReward).insert({
                profileUserId: buyer,
                rewardId: first.reward.id,
                sourceContractId: null,
                unlockedAt: NOW,
            });

            const [buyerAgain, newcomerAgain] = await Promise.all([
                service.getEmporium(buyer, NOW),
                service.getEmporium(newcomer, NOW),
            ]);
            const buyerListing = buyerAgain.rotatingItems.find(
                (item) => item.id === first.id,
            );
            const newcomerListing = newcomerAgain.rotatingItems.find(
                (item) => item.id === first.id,
            );
            expect(buyerListing?.owned).toBe(true);
            expect(buyerListing?.canPurchase).toBe(false);
            expect(newcomerListing?.owned).toBe(false);
            expect(
                newcomerAgain.rotatingItems.every((i) => !i.canPurchase),
            ).toBe(true);
            expect(buyerAgain.rotatingItems.some((i) => i.canPurchase)).toBe(
                true,
            );
        });
    });

    describe("availability", () => {
        it("404s inactive listings and rotating listings outside the month's showcase", async () => {
            const member = await createMember({
                rank: GuildRank.S,
                sealsBalance: 1_000,
            });
            const inactive = await seedItem(
                await seedReward("inactive_listing", GuildRewardKind.TITLE),
                { isActive: false, priceSeals: 10 },
            );
            const view = await service.getEmporium(member, NOW);
            expect(view.permanentItems.map((item) => item.id)).not.toContain(
                inactive,
            );
            await expect(
                service.purchase(member, { emporiumItemId: inactive }, NOW),
            ).rejects.toBeInstanceOf(NotFoundException);

            const showcased = new Set(
                view.rotatingItems.map((item) => item.id),
            );
            const excluded = (await activeRotatingPool()).find(
                (item) => !showcased.has(item.id),
            );
            expect(excluded).toBeDefined();
            await expect(
                service.purchase(member, { emporiumItemId: excluded!.id }, NOW),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe("purchase", () => {
        it("debits Seals, records the purchase and unlocks a permanent cosmetic", async () => {
            const rewardId = await seedReward(
                "license_purchase",
                GuildRewardKind.LICENSE_THEME,
            );
            const itemId = await seedItem(rewardId, {
                priceSeals: 120,
                minRank: GuildRank.C,
            });
            const userId = await createMember({
                rank: GuildRank.C,
                sealsBalance: 150,
            });

            const purchase = await service.purchase(
                userId,
                { emporiumItemId: itemId },
                NOW,
            );
            expect(purchase.sealsBalance).toBe(30);
            expect(purchase.reward.id).toBe(rewardId);
            expect(purchase.chestResult).toBeNull();

            await expect(
                source.getRepository(UserGuildReward).existsBy({
                    profileUserId: userId,
                    rewardId,
                }),
            ).resolves.toBe(true);
            const recorded = await source
                .getRepository(GuildEmporiumPurchase)
                .find({
                    where: { profileUserId: userId, emporiumItemId: itemId },
                });
            expect(recorded).toHaveLength(1);
            expect(recorded[0]).toMatchObject({
                monthKey: MONTH_KEY,
                priceSeals: 120,
            });

            await expect(
                permanentListing(userId, itemId),
            ).resolves.toMatchObject({
                owned: true,
                purchasedThisMonth: 1,
                canPurchase: false,
            });

            const rejection = await rejectionOf(
                service.purchase(userId, { emporiumItemId: itemId }, NOW),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getStatus()).toBe(409);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_emporium_already_owned",
            });
            await expect(profileOf(userId)).resolves.toMatchObject({
                sealsBalance: 30,
            });
        });

        it("returns the committed Seals balance after a chest reward payout", async () => {
            const rewardId = await seedReward(
                "chest_bronze",
                GuildRewardKind.CHEST_BRONZE,
            );
            const itemId = await seedItem(rewardId, { priceSeals: 100 });
            const userId = await createMember({
                rank: GuildRank.S,
                sealsBalance: 1_000,
            });

            const purchase = await service.purchase(
                userId,
                { emporiumItemId: itemId },
                NOW,
            );
            expect(purchase.chestResult).not.toBeNull();
            expect(purchase.sealsBalance).toBe(
                1_000 - 100 + purchase.chestResult!.bonusSeals,
            );
            await expect(profileOf(userId)).resolves.toMatchObject({
                sealsBalance: purchase.sealsBalance,
            });
        });

        it("rejects a listing above the buyer's rank without mutating the balance", async () => {
            const itemId = await seedItem(
                await seedReward(
                    "license_rank_gate",
                    GuildRewardKind.LICENSE_THEME,
                ),
                { priceSeals: 100, minRank: GuildRank.A },
            );
            const userId = await createMember({
                rank: GuildRank.D,
                sealsBalance: 1_000,
            });

            const rejection = await rejectionOf(
                service.purchase(userId, { emporiumItemId: itemId }, NOW),
            );
            expect(rejection).toBeInstanceOf(ForbiddenException);
            expect(rejection.getStatus()).toBe(403);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_emporium_rank_required",
            });
            await expect(profileOf(userId)).resolves.toMatchObject({
                sealsBalance: 1_000,
            });
            await expect(
                source.getRepository(GuildEmporiumPurchase).count({
                    where: { profileUserId: userId },
                }),
            ).resolves.toBe(0);
            await expect(
                source.getRepository(UserGuildReward).count({
                    where: { profileUserId: userId },
                }),
            ).resolves.toBe(0);
        });

        it("rejects an insufficient Seals balance without mutating it", async () => {
            const itemId = await seedItem(
                await seedReward(
                    "license_pricey",
                    GuildRewardKind.LICENSE_THEME,
                ),
                { priceSeals: 500, minRank: GuildRank.E },
            );
            const userId = await createMember({
                rank: GuildRank.S,
                sealsBalance: 100,
            });

            const rejection = await rejectionOf(
                service.purchase(userId, { emporiumItemId: itemId }, NOW),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_insufficient_seals",
            });
            await expect(profileOf(userId)).resolves.toMatchObject({
                sealsBalance: 100,
            });
        });

        it("enforces maxPurchasesPerMonth for repeatable rewards", async () => {
            const rewardId = await seedReward(
                "hourglass_capped",
                GuildRewardKind.CONSUMABLE,
                { consumableKey: GuildConsumableKey.HOURGLASS },
            );
            const itemId = await seedItem(rewardId, {
                priceSeals: 50,
                maxPurchasesPerMonth: 1,
            });
            const userId = await createMember({ sealsBalance: 200 });

            const first = await service.purchase(
                userId,
                { emporiumItemId: itemId },
                NOW,
            );
            expect(first.sealsBalance).toBe(150);
            expect(first.consumables.hourglass).toBe(1);

            const rejection = await rejectionOf(
                service.purchase(userId, { emporiumItemId: itemId }, NOW),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_emporium_monthly_limit_reached",
            });
            await expect(profileOf(userId)).resolves.toMatchObject({
                sealsBalance: 150,
            });
            await expect(
                permanentListing(userId, itemId),
            ).resolves.toMatchObject({
                owned: false,
                purchasedThisMonth: 1,
                canPurchase: false,
            });
        });

        it("lets exactly one of two concurrent cosmetic purchases win", async () => {
            const rewardId = await seedReward(
                "license_race",
                GuildRewardKind.LICENSE_THEME,
            );
            const itemId = await seedItem(rewardId, { priceSeals: 100 });
            const userId = await createMember({ sealsBalance: 1_000 });

            const outcomes = await Promise.allSettled([
                service.purchase(userId, { emporiumItemId: itemId }, NOW),
                service.purchase(userId, { emporiumItemId: itemId }, NOW),
            ]);

            const fulfilled = outcomes.filter(
                (outcome) => outcome.status === "fulfilled",
            );
            const rejected = outcomes.filter(
                (outcome): outcome is PromiseRejectedResult =>
                    outcome.status === "rejected",
            );
            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason).toBeInstanceOf(ConflictException);
            expect(rejected[0].reason.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_emporium_already_owned",
            });

            await expect(profileOf(userId)).resolves.toMatchObject({
                sealsBalance: 900,
            });
            await expect(
                source.getRepository(UserGuildReward).count({
                    where: { profileUserId: userId, rewardId },
                }),
            ).resolves.toBe(1);
            await expect(
                source.getRepository(GuildEmporiumPurchase).count({
                    where: { profileUserId: userId, emporiumItemId: itemId },
                }),
            ).resolves.toBe(1);
        });

        it("serializes concurrent purchases so a tight balance never goes negative", async () => {
            const itemId = await seedItem(
                await seedReward("hourglass_race", GuildRewardKind.CONSUMABLE, {
                    consumableKey: GuildConsumableKey.HOURGLASS,
                }),
                { priceSeals: 60 },
            );
            const userId = await createMember({ sealsBalance: 100 });

            const outcomes = await Promise.allSettled([
                service.purchase(userId, { emporiumItemId: itemId }, NOW),
                service.purchase(userId, { emporiumItemId: itemId }, NOW),
            ]);

            const fulfilled = outcomes.filter(
                (outcome) => outcome.status === "fulfilled",
            );
            const rejected = outcomes.filter(
                (outcome): outcome is PromiseRejectedResult =>
                    outcome.status === "rejected",
            );
            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason).toBeInstanceOf(ConflictException);
            expect(rejected[0].reason.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_insufficient_seals",
            });
            await expect(profileOf(userId)).resolves.toMatchObject({
                sealsBalance: 40,
            });
            await expect(
                source
                    .getRepository(GuildEmporiumPurchase)
                    .count({ where: { profileUserId: userId } }),
            ).resolves.toBe(1);
        });
    });

    describe("extra slot permit", () => {
        it("activates one permit for the current week and refuses a second activation", async () => {
            const userId = await createMember();
            await source.transaction((manager: EntityManager) =>
                seals.grantConsumableWithManager(
                    manager,
                    userId,
                    GuildConsumableKey.EXTRA_SLOT_PERMIT,
                    2,
                ),
            );

            const activated = await service.activateExtraSlotPermit(
                userId,
                NOW,
            );
            expect(activated).toEqual({
                weekStart: WEEK_START,
                activeThisWeek: true,
                expiresAt: nextMondayRefreshAt(WEEK_START),
                remainingPermits: 1,
            });
            await expect(profileOf(userId)).resolves.toMatchObject({
                extraSlotPermitWeekStart: WEEK_START,
            });

            const rejection = await rejectionOf(
                service.activateExtraSlotPermit(userId, NOW),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getStatus()).toBe(409);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_permit_already_active",
            });
            await expect(
                seals.getConsumableBalances(userId),
            ).resolves.toMatchObject({
                [GuildConsumableKey.EXTRA_SLOT_PERMIT]: 1,
            });
        });

        it("rejects activation when the user owns no permit", async () => {
            const userId = await createMember();

            const rejection = await rejectionOf(
                service.activateExtraSlotPermit(userId, NOW),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_consumable_not_owned",
            });
            await expect(profileOf(userId)).resolves.toMatchObject({
                extraSlotPermitWeekStart: null,
            });
        });
    });

    describe("admin catalog", () => {
        it("creates, lists and updates listings and validates their reward", async () => {
            const rewardId = await seedReward(
                "license_editorial",
                GuildRewardKind.LICENSE_THEME,
            );

            const created = await service.createAdminItem({
                rewardId,
                priceSeals: 140,
                minRank: GuildRank.D,
                isRotating: true,
            });
            expect(created).toMatchObject({
                priceSeals: 140,
                minRank: GuildRank.D,
                isRotating: true,
                maxPurchasesPerMonth: null,
                isActive: true,
            });
            expect(created.reward.id).toBe(rewardId);

            const listed = await service.listAdminItems();
            expect(listed.map((item) => item.id)).toContain(created.id);
            const pool = await activeRotatingPool();
            expect(pool.map((item) => item.id)).toContain(created.id);

            const updated = await service.updateAdminItem(created.id, {
                priceSeals: 160,
                maxPurchasesPerMonth: 2,
                isActive: false,
            });
            expect(updated).toMatchObject({
                priceSeals: 160,
                maxPurchasesPerMonth: 2,
                isActive: false,
            });
            expect(
                (await activeRotatingPool()).map((item) => item.id),
            ).not.toContain(created.id);

            await expect(
                service.createAdminItem({
                    rewardId: randomUUID(),
                    priceSeals: 100,
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                service.createAdminItem({ rewardId, priceSeals: 0 }),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                service.updateAdminItem(randomUUID(), { priceSeals: 10 }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it("keeps the admin Emporium surface behind ADMIN/EDITOR", () => {
            expect(Reflect.getMetadata("path", GuildAdminController)).toBe(
                "guild/admin",
            );
            expect(Reflect.getMetadata("roles", GuildAdminController)).toEqual([
                EUserRoles.ADMIN,
                EUserRoles.EDITOR,
            ]);
        });
    });
});
