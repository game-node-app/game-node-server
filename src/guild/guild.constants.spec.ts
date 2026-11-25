import { createHash } from "node:crypto";
import {
    computeGuildPrestige,
    computeGuildRank,
    currentMonthKey,
    currentWeekStart,
    DAY_MS,
    defaultSealsForRank,
    DUPLICATE_BADGE_BONUS_SEALS,
    DUPLICATE_COSMETIC_BONUS_XP,
    getGuildRankPerks,
    GUILD_CHEST_TIERS,
    GUILD_CHEST_UPGRADE_LADDER,
    GUILD_GLOBAL_XP_MULTIPLIER,
    GUILD_INACTIVITY_DAYS,
    GUILD_MAX_ACTIVE_CONTRACTS,
    GUILD_MIN_REVIEW_CHARS,
    GUILD_RANK_ECONOMY,
    GUILD_RANK_PROMOTION_REWARDS,
    GuildBoardCycle,
    GuildCategory,
    GuildConsumableKey,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
    GuildRewardRarity,
    guildRankAtLeast,
    nextMondayRefreshAt,
    nextMonthResetAt,
    resolveGuildChestTier,
    seededOrder,
    STALE_BACKLOG_DAYS,
    upgradeGuildChestTier,
    weekStartToUtcDate,
} from "./guild.constants";
import {
    GUILD_SYSTEM_TEMPLATES,
    validateGuildBonusObjective,
    validateGuildQuestRules,
} from "./guild-templates.constants";

describe("guild constants", () => {
    it("keeps the contract cap, duplicate bonus and inactivity window", () => {
        expect(GUILD_MAX_ACTIVE_CONTRACTS).toBe(3);
        expect(DUPLICATE_COSMETIC_BONUS_XP).toBe(50);
        expect(DUPLICATE_BADGE_BONUS_SEALS).toBe(25);
        expect(GUILD_INACTIVITY_DAYS).toBe(30);
    });

    it("keeps the global XP share, review minimum and shared day constants", () => {
        expect(GUILD_GLOBAL_XP_MULTIPLIER).toBe(0.25);
        expect(GUILD_MIN_REVIEW_CHARS).toBe(80);
        expect(DAY_MS).toBe(86_400_000);
        expect(STALE_BACKLOG_DAYS).toBe(365);
    });

    it("rebalances the XP and Seals economy per rank", () => {
        expect(GUILD_RANK_ECONOMY[GuildRank.E]).toEqual({
            xpMin: 60,
            xpMax: 100,
            seals: 10,
        });
        expect(GUILD_RANK_ECONOMY[GuildRank.S]).toEqual({
            xpMin: 1_200,
            xpMax: 1_500,
            seals: 200,
        });
        expect(
            Object.values(GUILD_RANK_ECONOMY).map((row) => row.seals),
        ).toEqual([10, 20, 35, 60, 110, 200]);
        for (const [rank, economy] of Object.entries(GUILD_RANK_ECONOMY))
            expect(defaultSealsForRank(rank as GuildRank)).toBe(economy.seals);
    });
});

describe("seededOrder", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const key = (item: string) => item;
    const seedFor = (value: string) =>
        createHash("sha256").update(value).digest();
    const hashFor = (seedHex: string, value: string) =>
        createHash("sha256").update(`${seedHex}:${value}`).digest("hex");

    it("orders by sha256(seedHex + ':' + key) and is stable for one seed", () => {
        const seed = seedFor("user:2026-11-02");
        const seedHex = seed.toString("hex");
        const expected = [...items].sort((a, b) =>
            hashFor(seedHex, a).localeCompare(hashFor(seedHex, b)),
        );

        const ordered = seededOrder(seed, items, key);

        expect(ordered).toEqual(expected);
        expect(seededOrder(seed, items, key)).toEqual(ordered);
        expect(seededOrder(seedHex, items, key)).toEqual(ordered);
    });

    it("keeps the input untouched and can differ between seeds", () => {
        const input = [...items];
        const first = seededOrder(seedFor("2026-11-02"), input, key);
        const second = seededOrder(seedFor("2026-11-09"), input, key);

        expect(input).toEqual(items);
        expect(first).toEqual(expect.arrayContaining(items));
        expect(first).not.toEqual(second);
    });

    it("keeps input order for items with equal keys", () => {
        const duplicates = [{ id: 1 }, { id: 2 }, { id: 3 }];

        expect(
            seededOrder("seed", duplicates, () => "same").map(
                (item) => item.id,
            ),
        ).toEqual([1, 2, 3]);
    });
});

describe("computeGuildRank", () => {
    it.each([
        {
            xp: 0,
            rank: GuildRank.E,
            minXp: 0,
            nextRank: GuildRank.D,
            nextRankXp: 300,
            xpToNextRank: 300,
        },
        {
            xp: 299,
            rank: GuildRank.E,
            minXp: 0,
            nextRank: GuildRank.D,
            nextRankXp: 300,
            xpToNextRank: 1,
        },
        {
            xp: 300,
            rank: GuildRank.D,
            minXp: 300,
            nextRank: GuildRank.C,
            nextRankXp: 800,
            xpToNextRank: 500,
        },
        {
            xp: 799,
            rank: GuildRank.D,
            minXp: 300,
            nextRank: GuildRank.C,
            nextRankXp: 800,
            xpToNextRank: 1,
        },
        {
            xp: 800,
            rank: GuildRank.C,
            minXp: 800,
            nextRank: GuildRank.B,
            nextRankXp: 2_000,
            xpToNextRank: 1_200,
        },
        {
            xp: 1_240,
            rank: GuildRank.C,
            minXp: 800,
            nextRank: GuildRank.B,
            nextRankXp: 2_000,
            xpToNextRank: 760,
        },
        {
            xp: 1_999,
            rank: GuildRank.C,
            minXp: 800,
            nextRank: GuildRank.B,
            nextRankXp: 2_000,
            xpToNextRank: 1,
        },
        {
            xp: 2_000,
            rank: GuildRank.B,
            minXp: 2_000,
            nextRank: GuildRank.A,
            nextRankXp: 4_000,
            xpToNextRank: 2_000,
        },
        {
            xp: 3_999,
            rank: GuildRank.B,
            minXp: 2_000,
            nextRank: GuildRank.A,
            nextRankXp: 4_000,
            xpToNextRank: 1,
        },
        {
            xp: 4_000,
            rank: GuildRank.A,
            minXp: 4_000,
            nextRank: GuildRank.S,
            nextRankXp: 7_500,
            xpToNextRank: 3_500,
        },
        {
            xp: 7_499,
            rank: GuildRank.A,
            minXp: 4_000,
            nextRank: GuildRank.S,
            nextRankXp: 7_500,
            xpToNextRank: 1,
        },
        {
            xp: 7_500,
            rank: GuildRank.S,
            minXp: 7_500,
            nextRank: null,
            nextRankXp: null,
            xpToNextRank: 0,
        },
        {
            xp: 25_000,
            rank: GuildRank.S,
            minXp: 7_500,
            nextRank: null,
            nextRankXp: null,
            xpToNextRank: 0,
        },
    ])(
        "maps $xp XP to rank $rank",
        ({ xp, rank, minXp, nextRank, nextRankXp, xpToNextRank }) => {
            expect(computeGuildRank(xp)).toEqual({
                rank,
                currentRankMinXp: minXp,
                nextRank,
                nextRankXp,
                xpToNextRank,
            });
        },
    );

    it("compares ranks for perk and quest gates", () => {
        expect(guildRankAtLeast(GuildRank.C, GuildRank.C)).toBe(true);
        expect(guildRankAtLeast(GuildRank.S, GuildRank.A)).toBe(true);
        expect(guildRankAtLeast(GuildRank.D, GuildRank.C)).toBe(false);
    });
});

describe("computeGuildPrestige", () => {
    it.each([
        { xp: 0, level: 0, into: 0, toNext: 2_500 },
        { xp: 7_499, level: 0, into: 0, toNext: 2_500 },
        { xp: 7_500, level: 0, into: 0, toNext: 2_500 },
        { xp: 9_800, level: 0, into: 2_300, toNext: 200 },
        { xp: 9_999, level: 0, into: 2_499, toNext: 1 },
        { xp: 10_000, level: 1, into: 0, toNext: 2_500 },
        // Spec: 9,800 XP claims +400 -> Prestige 1, 200 into the star, 2,300 to the next.
        { xp: 10_200, level: 1, into: 200, toNext: 2_300 },
        { xp: 12_500, level: 2, into: 0, toNext: 2_500 },
        { xp: 20_000, level: 5, into: 0, toNext: 2_500 },
    ])(
        "maps $xp XP to Prestige $level ($into into current)",
        ({ xp, level, into, toNext }) => {
            expect(computeGuildPrestige(xp)).toEqual({
                prestigeLevel: level,
                prestigeXpIntoCurrent: into,
                xpToNextPrestige: toNext,
            });
        },
    );
});

describe("guild rank perks and promotion packages", () => {
    it("unlocks functional perks at D, C, B, A and S", () => {
        expect(getGuildRankPerks(GuildRank.E)).toMatchObject({
            maxActiveContracts: 3,
            weeklyRerolls: 0,
            monthlyExpedition: false,
            monthlyExpeditionRankS: false,
            monthlyFreeHourglass: 0,
            legendaryContracts: false,
        });
        expect(getGuildRankPerks(GuildRank.D)).toMatchObject({
            maxActiveContracts: 3,
            weeklyRerolls: 1,
            monthlyExpedition: false,
        });
        expect(getGuildRankPerks(GuildRank.C)).toMatchObject({
            maxActiveContracts: 3,
            monthlyExpedition: true,
            monthlyExpeditionRankS: false,
        });
        expect(getGuildRankPerks(GuildRank.B)).toMatchObject({
            maxActiveContracts: 4,
            monthlyExpedition: true,
        });
        expect(getGuildRankPerks(GuildRank.A)).toMatchObject({
            maxActiveContracts: 4,
            monthlyExpeditionRankS: true,
            monthlyFreeHourglass: 1,
            legendaryContracts: false,
        });
        expect(getGuildRankPerks(GuildRank.S)).toMatchObject({
            maxActiveContracts: 4,
            weeklyRerolls: 2,
            monthlyFreeHourglass: 1,
            legendaryContracts: true,
        });
        expect(getGuildRankPerks(undefined as unknown as GuildRank)).toEqual(
            getGuildRankPerks(GuildRank.E),
        );
    });

    it("grants cosmetics once per crossed rank, D through S", () => {
        expect(GUILD_RANK_PROMOTION_REWARDS[GuildRank.E]).toEqual([]);
        for (const rank of [
            GuildRank.D,
            GuildRank.C,
            GuildRank.B,
            GuildRank.A,
            GuildRank.S,
        ])
            expect(GUILD_RANK_PROMOTION_REWARDS[rank].length).toBeGreaterThan(
                0,
            );
        expect(GUILD_RANK_PROMOTION_REWARDS[GuildRank.B]).toEqual([
            "frame_forged_steel",
            "decor_sleeping_cat",
        ]);
        const allKeys = Object.values(GUILD_RANK_PROMOTION_REWARDS).flat();
        expect(new Set(allKeys).size).toBe(allKeys.length);
    });
});

describe("guild chest tiers", () => {
    it("keeps the four tiers and their design 5 payouts", () => {
        expect(GUILD_CHEST_TIERS[GuildRewardKind.CHEST_BRONZE]).toMatchObject({
            bonusXp: 40,
            bonusSeals: 15,
            poolRarities: [GuildRewardRarity.COMMON],
            exhaustedBonusXp: 50,
            exhaustedBonusSeals: 25,
        });
        expect(GUILD_CHEST_TIERS[GuildRewardKind.CHEST_SILVER]).toMatchObject({
            bonusXp: 75,
            bonusSeals: 30,
            poolRarities: [GuildRewardRarity.UNCOMMON],
            fallbackRarities: [GuildRewardRarity.COMMON],
            exhaustedBonusSeals: 45,
        });
        expect(GUILD_CHEST_TIERS[GuildRewardKind.CHEST_GOLD]).toMatchObject({
            bonusXp: 125,
            bonusSeals: 60,
            poolRarities: [GuildRewardRarity.RARE],
            consumableDropChance: 0.35,
            consumableKeys: [
                GuildConsumableKey.HOURGLASS,
                GuildConsumableKey.REROLL_CHARTER,
            ],
        });
        expect(GUILD_CHEST_TIERS[GuildRewardKind.CHEST_RELIC]).toMatchObject({
            bonusXp: 200,
            bonusSeals: 120,
            poolRarities: [GuildRewardRarity.LEGENDARY, GuildRewardRarity.EPIC],
            fallbackRarities: [GuildRewardRarity.RARE],
            consumableDropChance: 1,
            consumableKeys: [
                GuildConsumableKey.HOURGLASS,
                GuildConsumableKey.REROLL_CHARTER,
                GuildConsumableKey.EXTRA_SLOT_PERMIT,
            ],
            exhaustedBonusSeals: 150,
        });
    });

    it("treats weekly_chest as Silver and upgrades one tier, capping at Relic", () => {
        expect(resolveGuildChestTier(GuildRewardKind.WEEKLY_CHEST)).toEqual(
            GUILD_CHEST_TIERS[GuildRewardKind.CHEST_SILVER],
        );
        expect(resolveGuildChestTier(GuildRewardKind.CHEST_GOLD)).toEqual(
            GUILD_CHEST_TIERS[GuildRewardKind.CHEST_GOLD],
        );
        expect(upgradeGuildChestTier(GuildRewardKind.CHEST_BRONZE)).toBe(
            GuildRewardKind.CHEST_SILVER,
        );
        expect(upgradeGuildChestTier(GuildRewardKind.WEEKLY_CHEST)).toBe(
            GuildRewardKind.CHEST_GOLD,
        );
        expect(upgradeGuildChestTier(GuildRewardKind.CHEST_GOLD)).toBe(
            GuildRewardKind.CHEST_RELIC,
        );
        expect(upgradeGuildChestTier(GuildRewardKind.CHEST_RELIC)).toBe(
            GuildRewardKind.CHEST_RELIC,
        );
        expect(GUILD_CHEST_UPGRADE_LADDER).toEqual([
            GuildRewardKind.CHEST_BRONZE,
            GuildRewardKind.CHEST_SILVER,
            GuildRewardKind.CHEST_GOLD,
            GuildRewardKind.CHEST_RELIC,
        ]);
    });
});

describe("guild weekly and monthly cycles", () => {
    it("starts on Monday 00:00 São Paulo", () => {
        // Sunday 23:59:59 in São Paulo, already Monday in UTC: still the previous week.
        expect(currentWeekStart(new Date("2026-11-09T02:59:59Z"))).toBe(
            "2026-11-02",
        );
        expect(currentWeekStart(new Date("2026-11-09T03:00:00Z"))).toBe(
            "2026-11-09",
        );
    });

    it("resolves a week start to São Paulo midnight", () => {
        expect(weekStartToUtcDate("2026-11-02").toISOString()).toBe(
            "2026-11-02T03:00:00.000Z",
        );
    });

    it("refreshes on the next Monday, across month and year ends", () => {
        expect(nextMondayRefreshAt("2026-11-02").toISOString()).toBe(
            "2026-11-09T03:00:00.000Z",
        );
        expect(nextMondayRefreshAt("2026-12-28").toISOString()).toBe(
            "2027-01-04T03:00:00.000Z",
        );
    });

    it("buckets São Paulo months and resets on the 1st at midnight", () => {
        // 23:59:59 on October 31 in São Paulo, already November in UTC.
        expect(currentMonthKey(new Date("2026-11-01T02:59:59Z"))).toBe(
            "2026-10",
        );
        expect(currentMonthKey(new Date("2026-11-01T03:00:00Z"))).toBe(
            "2026-11",
        );
        expect(
            nextMonthResetAt(new Date("2026-11-15T12:00:00Z")).toISOString(),
        ).toBe("2026-12-01T03:00:00.000Z");
        expect(
            nextMonthResetAt(new Date("2026-12-15T12:00:00Z")).toISOString(),
        ).toBe("2027-01-01T03:00:00.000Z");
    });
});

describe("guild system templates", () => {
    const templateByKey = (key: string) => {
        const template = GUILD_SYSTEM_TEMPLATES.find(
            (item) => item.key === key,
        );
        expect(template).toBeDefined();
        return template!;
    };

    it("defines all 31 templates: 24 weekly-pool and 7 monthly expeditions", () => {
        expect(GUILD_SYSTEM_TEMPLATES).toHaveLength(31);
        expect(GUILD_SYSTEM_TEMPLATES.map(({ key }) => key)).toEqual([
            "recent_dust",
            "forgotten_relic",
            "deep_dive",
            "off_the_map",
            "continue_the_saga",
            "time_machine",
            "return_to_the_world",
            "hidden_gem",
            "short_caravan",
            "weekend_sprint",
            "double_feature",
            "field_vigil",
            "backlog_taste_test",
            "campaign_rhythm",
            "trophy_hunter",
            "captains_log",
            "quick_take",
            "on_duty_critic",
            "deep_critic",
            "guild_oracle",
            "eagle_eye",
            "cartographer",
            "expedition_log",
            "pack_cleanup",
            "the_colossus",
            "ancient_fossil",
            "genre_marathon",
            "deep_critic_anthology",
            "platinum_crown",
            "colossus_legend",
            "saga_trilogy",
        ]);
        const keys = GUILD_SYSTEM_TEMPLATES.map((item) => item.key);
        expect(new Set(keys).size).toBe(keys.length);

        const weekly = GUILD_SYSTEM_TEMPLATES.filter(
            (item) => item.cycle === GuildBoardCycle.WEEKLY,
        );
        const monthly = GUILD_SYSTEM_TEMPLATES.filter(
            (item) => item.cycle === GuildBoardCycle.MONTHLY,
        );
        expect(weekly).toHaveLength(24);
        expect(monthly).toHaveLength(7);
        expect(
            GUILD_SYSTEM_TEMPLATES.filter(
                (item) => item.category === GuildCategory.LIBRARY,
            ),
        ).toHaveLength(8);
        expect(
            GUILD_SYSTEM_TEMPLATES.filter(
                (item) => item.category === GuildCategory.WEEKLY,
            ),
        ).toHaveLength(7);
        expect(
            GUILD_SYSTEM_TEMPLATES.filter(
                (item) => item.category === GuildCategory.GAMENODE,
            ),
        ).toHaveLength(9);
        expect(
            GUILD_SYSTEM_TEMPLATES.filter(
                (item) => item.category === GuildCategory.MONTHLY,
            ),
        ).toHaveLength(7);
    });

    it("accepts every template's objective, target and criteria", () => {
        for (const template of GUILD_SYSTEM_TEMPLATES)
            expect({
                key: template.key,
                errors: validateGuildQuestRules(
                    template.objectiveType,
                    template.targetCount,
                    template.criteria,
                ),
            }).toEqual({ key: template.key, errors: [] });
    });

    it("gives every template a rank, minRank, Seals and duration", () => {
        for (const template of GUILD_SYSTEM_TEMPLATES) {
            expect(Object.values(GuildRank)).toContain(template.rank);
            expect(Object.values(GuildRank)).toContain(template.minRank);
            expect(guildRankAtLeast(template.rank, template.minRank)).toBe(
                true,
            );
            expect(template.sealsReward).toBeGreaterThan(0);
            expect(template.xpReward).toBeGreaterThan(0);
            expect(template.contractDurationDays).toBeGreaterThan(0);
        }
        expect(
            GUILD_SYSTEM_TEMPLATES.filter(
                (item) => item.category === GuildCategory.LIBRARY,
            ).every((item) => item.contractDurationDays === 21),
        ).toBe(true);
        expect(
            GUILD_SYSTEM_TEMPLATES.filter(
                (item) =>
                    item.category === GuildCategory.WEEKLY ||
                    item.category === GuildCategory.GAMENODE,
            ).every((item) => item.contractDurationDays === 7),
        ).toBe(true);
        expect(
            GUILD_SYSTEM_TEMPLATES.filter(
                (item) => item.category === GuildCategory.MONTHLY,
            ).map((item) => item.contractDurationDays),
        ).toEqual([45, 45, 30, 30, 60, 60, 60]);
    });

    it("matches the design payouts for the key weekly quests", () => {
        expect(templateByKey("forgotten_relic")).toMatchObject({
            category: GuildCategory.LIBRARY,
            rank: GuildRank.B,
            minRank: GuildRank.E,
            xpReward: 420,
            sealsReward: 60,
            objectiveType: GuildObjectiveType.FINISH_GAME,
            rewardKey: "badge_archaeologist",
            contractDurationDays: 21,
        });
        expect(templateByKey("recent_dust")).toMatchObject({
            rank: GuildRank.C,
            xpReward: 260,
            sealsReward: 35,
            rewardKey: "chest_silver",
        });
        expect(templateByKey("short_caravan")).toMatchObject({
            rank: GuildRank.D,
            xpReward: 170,
            sealsReward: 20,
            criteria: { maxTimeToBeatHours: 8 },
            rewardKey: "chest_bronze",
            isQuick: true,
        });
        expect(templateByKey("field_vigil")).toMatchObject({
            objectiveType: GuildObjectiveType.LOG_PLAYTIME,
            targetCount: 240,
        });
        expect(templateByKey("backlog_taste_test")).toMatchObject({
            objectiveType: GuildObjectiveType.LOG_PLAYTIME,
            targetCount: 2,
            criteria: { minPlaytimeSecondsPerGame: 2_700 },
        });
        expect(templateByKey("campaign_rhythm")).toMatchObject({
            objectiveType: GuildObjectiveType.PLAY_DISTINCT_DAYS,
            targetCount: 4,
        });
        expect(templateByKey("trophy_hunter")).toMatchObject({
            objectiveType: GuildObjectiveType.EARN_GAME_ACHIEVEMENTS,
            targetCount: 10,
        });
        expect(templateByKey("quick_take")).toMatchObject({
            category: GuildCategory.GAMENODE,
            rank: GuildRank.E,
            xpReward: 70,
            sealsReward: 10,
            objectiveType: GuildObjectiveType.WRITE_REVIEW,
            targetCount: 1,
            criteria: {},
            rewardKey: null,
            contractDurationDays: 7,
        });
        expect(templateByKey("eagle_eye")).toMatchObject({
            objectiveType: GuildObjectiveType.DAILY_CHALLENGE,
            criteria: { requireNoDailyHint: true, maxDailyAttempts: 3 },
        });
        expect(templateByKey("cartographer")).toMatchObject({
            objectiveType: GuildObjectiveType.CURATE_COLLECTION,
            criteria: { minCollectionEntries: 5 },
        });
        expect(templateByKey("expedition_log")).toMatchObject({
            objectiveType: GuildObjectiveType.PUBLISH_POST,
            criteria: { minPostChars: 80 },
        });
        expect(templateByKey("pack_cleanup")).toMatchObject({
            objectiveType: GuildObjectiveType.TRIAGE_BACKLOG,
            targetCount: 3,
        });
    });

    it("matches the design payouts for the monthly expeditions", () => {
        expect(templateByKey("the_colossus")).toMatchObject({
            category: GuildCategory.MONTHLY,
            rank: GuildRank.A,
            minRank: GuildRank.C,
            xpReward: 750,
            sealsReward: 110,
            criteria: { minTimeToBeatHours: 35 },
            rewardKey: "chest_gold",
            contractDurationDays: 45,
        });
        expect(templateByKey("ancient_fossil")).toMatchObject({
            rank: GuildRank.A,
            minRank: GuildRank.C,
            xpReward: 720,
            rewardKey: "chest_gold",
        });
        expect(templateByKey("genre_marathon")).toMatchObject({
            rank: GuildRank.A,
            targetCount: 3,
            contractDurationDays: 30,
        });
        expect(templateByKey("deep_critic_anthology")).toMatchObject({
            rank: GuildRank.A,
            minRank: GuildRank.C,
            criteria: { minReviewChars: 250 },
            contractDurationDays: 30,
        });
        expect(templateByKey("platinum_crown")).toMatchObject({
            rank: GuildRank.S,
            minRank: GuildRank.A,
            xpReward: 1_350,
            sealsReward: 200,
            objectiveType: GuildObjectiveType.COMPLETE_GAME_100,
            rewardKey: "chest_relic",
            contractDurationDays: 60,
        });
        expect(templateByKey("colossus_legend")).toMatchObject({
            rank: GuildRank.S,
            minRank: GuildRank.A,
            xpReward: 1_400,
            criteria: { minTimeToBeatHours: 60 },
            rewardKey: "chest_relic",
        });
        expect(templateByKey("saga_trilogy")).toMatchObject({
            rank: GuildRank.S,
            minRank: GuildRank.A,
            targetCount: 3,
            rewardKey: "chest_relic",
        });
    });
});

describe("guild quest rules", () => {
    it("validates the objective type and target count", () => {
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {}),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.WRITE_REVIEW, 3, {}),
        ).toEqual([]);
        expect(validateGuildQuestRules("watch_trailer", 1, {})).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 0, {}),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1.5, {}),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, "1", {}),
        ).not.toEqual([]);
    });

    it("accepts the extended IGDB criteria on game-scoped objectives", () => {
        const criteria = {
            gameIds: [1, 2],
            genreIds: [8],
            themeIds: [19],
            keywordIds: [2045],
            franchiseIds: [11],
            platformIds: [6],
            gameCategories: [0, 1],
            maxTimeToBeatHours: 80,
            minTimeToBeatHours: 35,
            releaseYearMin: 1990,
            releaseYearMax: 1999,
            indieOnly: true,
        };
        expect(
            validateGuildQuestRules(
                GuildObjectiveType.FINISH_GAME,
                1,
                criteria,
            ),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(
                GuildObjectiveType.LOG_PLAYTIME,
                300,
                criteria,
            ),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(
                GuildObjectiveType.PLAY_DISTINCT_DAYS,
                4,
                criteria,
            ),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(
                GuildObjectiveType.EARN_GAME_ACHIEVEMENTS,
                10,
                criteria,
            ),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(
                GuildObjectiveType.COMPLETE_GAME_100,
                1,
                criteria,
            ),
        ).toEqual([]);
    });

    it("validates criteria values", () => {
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                gameIds: [0],
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                genreIds: ["8"],
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                keywordIds: [1.5],
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                maxTimeToBeatHours: 0,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                minTimeToBeatHours: -1,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                gameCategories: [0, -1],
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                releaseYearMin: 1999.5,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                indieOnly: "yes",
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                unsupported: true,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, []),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, "{}"),
        ).not.toEqual([]);
    });

    it("rejects inverted time-to-beat and release-year ranges", () => {
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                minTimeToBeatHours: 60,
                maxTimeToBeatHours: 35,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                releaseYearMin: 2000,
                releaseYearMax: 1999,
            }),
        ).not.toEqual([]);
    });

    it("rejects criteria keys the objective does not support", () => {
        expect(
            validateGuildQuestRules(GuildObjectiveType.DAILY_CHALLENGE, 2, {
                minTimeToBeatHours: 40,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.DAILY_CHALLENGE, 2, {
                requireNoDailyHint: true,
                maxDailyAttempts: 3,
            }),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.CURATE_COLLECTION, 1, {
                minCollectionEntries: 5,
            }),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.PUBLISH_POST, 1, {
                minPostChars: 80,
            }),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.TRIAGE_BACKLOG, 3, {
                minPostChars: 80,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.WRITE_REVIEW, 1, {
                finishedInCurrentMonth: "yes",
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.WRITE_REVIEW, 1, {
                minReviewChars: 200,
            }),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.WRITE_REVIEW, 1, {
                minReviewChars: 0,
            }),
        ).not.toEqual([]);
    });
});

describe("guild bonus objectives", () => {
    it("accepts every supported bonus objective", () => {
        expect(validateGuildBonusObjective(null)).toEqual([]);
        expect(validateGuildBonusObjective(undefined)).toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "also_write_review",
                minChars: 150,
                bonusXp: 50,
                bonusSeals: 15,
            }),
        ).toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "finish_before_half_deadline",
                upgradeChestTier: true,
            }),
        ).toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "use_stale_backlog_game",
                staleDays: 180,
                bonusSeals: 0,
            }),
        ).toEqual([]);
    });

    it("rejects invalid bonus objectives", () => {
        expect(validateGuildBonusObjective("review")).not.toEqual([]);
        expect(validateGuildBonusObjective([])).not.toEqual([]);
        expect(validateGuildBonusObjective({})).not.toEqual([]);
        expect(
            validateGuildBonusObjective({ type: "watch_trailer" }),
        ).not.toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "also_write_review",
                minChars: 0,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "also_write_review",
                minChars: "150",
            }),
        ).not.toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "use_stale_backlog_game",
                staleDays: -1,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "finish_before_half_deadline",
                upgradeChestTier: "yes",
            }),
        ).not.toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "finish_before_half_deadline",
                bonusXp: -5,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildBonusObjective({
                type: "finish_before_half_deadline",
                unsupported: true,
            }),
        ).not.toEqual([]);
    });
});
