import { createHash } from "node:crypto";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { addDays, dailyToday, mondayOf } from "../daily/daily.constants";
import type { GuildRewardDescriptorDto } from "./dto/guild-rewards.dto";
import type { GuildReward } from "./entities/guild-reward.entity";

/** Guild progression ranks, easiest to hardest (design 2). */
export enum GuildRank {
    E = "E",
    D = "D",
    C = "C",
    B = "B",
    A = "A",
    S = "S",
}

/** Minimum cumulative Guild XP per rank, in order. */
export const GUILD_RANK_THRESHOLDS: ReadonlyArray<{
    rank: GuildRank;
    minXp: number;
}> = [
    { rank: GuildRank.E, minXp: 0 },
    { rank: GuildRank.D, minXp: 300 },
    { rank: GuildRank.C, minXp: 800 },
    { rank: GuildRank.B, minXp: 2_000 },
    { rank: GuildRank.A, minXp: 4_000 },
    { rank: GuildRank.S, minXp: 7_500 },
];

export interface GuildRankProgress {
    rank: GuildRank;
    currentRankMinXp: number;
    nextRank: GuildRank | null;
    nextRankXp: number | null;
    xpToNextRank: number;
}

/** Rank and next-rank progress for a cumulative XP total; S is the top rank. */
export function computeGuildRank(xp: number): GuildRankProgress {
    const index = Math.max(
        GUILD_RANK_THRESHOLDS.findLastIndex(
            (threshold) => xp >= threshold.minXp,
        ),
        0,
    );
    const current = GUILD_RANK_THRESHOLDS[index];
    const next = GUILD_RANK_THRESHOLDS[index + 1] ?? null;
    return {
        rank: current.rank,
        currentRankMinXp: current.minXp,
        nextRank: next?.rank ?? null,
        nextRankXp: next?.minXp ?? null,
        xpToNextRank: next ? next.minXp - xp : 0,
    };
}

/** Cumulative rank order, for threshold comparisons (rank gates, expeditions). */
export const GUILD_RANK_ORDER: Record<GuildRank, number> = {
    [GuildRank.E]: 0,
    [GuildRank.D]: 1,
    [GuildRank.C]: 2,
    [GuildRank.B]: 3,
    [GuildRank.A]: 4,
    [GuildRank.S]: 5,
};

export const guildRankAtLeast = (
    rank: GuildRank,
    minRank: GuildRank,
): boolean => GUILD_RANK_ORDER[rank] >= GUILD_RANK_ORDER[minRank];

/** Rank-scaled XP and Seals payouts (design 2); admins default Seals from this. */
export const GUILD_RANK_ECONOMY: Record<
    GuildRank,
    { xpMin: number; xpMax: number; seals: number }
> = {
    [GuildRank.E]: { xpMin: 60, xpMax: 100, seals: 10 },
    [GuildRank.D]: { xpMin: 120, xpMax: 180, seals: 20 },
    [GuildRank.C]: { xpMin: 220, xpMax: 320, seals: 35 },
    [GuildRank.B]: { xpMin: 360, xpMax: 500, seals: 60 },
    [GuildRank.A]: { xpMin: 650, xpMax: 900, seals: 110 },
    [GuildRank.S]: { xpMin: 1_200, xpMax: 1_500, seals: 200 },
};

export const defaultSealsForRank = (rank: GuildRank): number =>
    GUILD_RANK_ECONOMY[rank]?.seals ?? GUILD_RANK_ECONOMY[GuildRank.E].seals;

export const GUILD_MAX_ACTIVE_CONTRACTS = 3;
export const GUILD_MAX_ACTIVE_CONTRACTS_RANK_B = 4;
/** Rank B cap plus an active `extra_slot_permit`. */
export const GUILD_MAX_ACTIVE_CONTRACTS_WITH_PERMIT = 5;

/** Awarded in place of a title or frame the user already owns (spec: rewards). */
export const DUPLICATE_COSMETIC_BONUS_XP = 50;
/** Added to the XP bonus when a claimed badge is already owned (spec: rewards). */
export const DUPLICATE_BADGE_BONUS_SEALS = 25;

/** Share of claimed Guild XP also credited to the global UserLevel (design 13). */
export const GUILD_GLOBAL_XP_MULTIPLIER = 0.25;

/** Trimmed review length that proves the reviewer actually played the game. */
export const GUILD_MIN_REVIEW_CHARS = 80;

/** Days without a Guild visit that trigger Lina's "returning" reception. */
export const GUILD_INACTIVITY_DAYS = 30;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** A planned/dropped game untouched for this long is a stale backlog relic. */
export const STALE_BACKLOG_DAYS = 365;
/** Backlog relic tiers: 90d recent dust, 365d relic, 1,095d ancient fossil. */
export const RECENT_DUST_DAYS = 90;
export const ANCIENT_FOSSIL_DAYS = 1_095;

/** Minimum per-day incremental playtime that counts toward a play-day. */
export const GUILD_MIN_PLAYTIME_SECONDS_PER_DAY = 900;

/** Defaults for optional contract bonus objectives (design 4). */
export const GUILD_BONUS_REVIEW_MIN_CHARS = 150;
export const GUILD_BONUS_STALE_DAYS = 180;

export const GUILD_PRESTIGE_MIN_XP = 7_500;
export const GUILD_PRESTIGE_XP_PER_STAR = 2_500;

export interface GuildPrestigeProgress {
    prestigeLevel: number;
    prestigeXpIntoCurrent: number;
    xpToNextPrestige: number;
}

/** Endless S+ progression: one prestige star per 2,500 XP past Rank S. */
export function computeGuildPrestige(xp: number): GuildPrestigeProgress {
    const prestigeXp = Math.max(0, xp - GUILD_PRESTIGE_MIN_XP);
    const prestigeXpIntoCurrent = prestigeXp % GUILD_PRESTIGE_XP_PER_STAR;
    return {
        prestigeLevel: Math.floor(prestigeXp / GUILD_PRESTIGE_XP_PER_STAR),
        prestigeXpIntoCurrent,
        xpToNextPrestige: GUILD_PRESTIGE_XP_PER_STAR - prestigeXpIntoCurrent,
    };
}

export enum GuildCategory {
    LIBRARY = "library",
    EVENT = "event",
    WEEKLY = "weekly",
    GAMENODE = "gamenode",
    MONTHLY = "monthly",
}

/** Automatic boards refresh weekly; Monthly Expeditions refresh monthly. */
export enum GuildBoardCycle {
    WEEKLY = "weekly",
    MONTHLY = "monthly",
}

export enum GuildObjectiveType {
    FINISH_GAME = "finish_game",
    WRITE_REVIEW = "write_review",
    LOG_PLAYTIME = "log_playtime",
    PLAY_DISTINCT_DAYS = "play_distinct_days",
    DAILY_CHALLENGE = "daily_challenge",
    EARN_GAME_ACHIEVEMENTS = "earn_game_achievements",
    COMPLETE_GAME_100 = "complete_game_100",
    CURATE_COLLECTION = "curate_collection",
    PUBLISH_POST = "publish_post",
    TRIAGE_BACKLOG = "triage_backlog",
}

export enum GuildContractStatus {
    ACTIVE = "active",
    READY_TO_CLAIM = "ready_to_claim",
    COMPLETED = "completed",
    ABANDONED = "abandoned",
    EXPIRED = "expired",
}

export enum GuildEventStatus {
    DRAFT = "draft",
    PUBLISHED = "published",
    ARCHIVED = "archived",
}

export enum GuildBountyStatus {
    DRAFT = "draft",
    PUBLISHED = "published",
    ARCHIVED = "archived",
}

/** Milestone percentages a Community Bounty can unlock. */
export const GUILD_BOUNTY_MILESTONES = [25, 50, 100, 150] as const;

export enum GuildRewardKind {
    BADGE = "badge",
    TITLE = "title",
    AVATAR_FRAME = "avatar_frame",
    LICENSE_THEME = "license_theme",
    STAMP_STYLE = "stamp_style",
    TAVERN_DECOR = "tavern_decor",
    CONSUMABLE = "consumable",
    WEEKLY_CHEST = "weekly_chest",
    CHEST_BRONZE = "chest_bronze",
    CHEST_SILVER = "chest_silver",
    CHEST_GOLD = "chest_gold",
    CHEST_RELIC = "chest_relic",
}

export enum GuildRewardRarity {
    COMMON = "common",
    UNCOMMON = "uncommon",
    RARE = "rare",
    EPIC = "epic",
    LEGENDARY = "legendary",
}

export enum GuildConsumableKey {
    HOURGLASS = "hourglass",
    REROLL_CHARTER = "reroll_charter",
    EXTRA_SLOT_PERMIT = "extra_slot_permit",
}

export enum GuildSealReason {
    CONTRACT_CLAIM = "contract_claim",
    BONUS_OBJECTIVE = "bonus_objective",
    CHEST_PAYOUT = "chest_payout",
    DUPLICATE_FALLBACK = "duplicate_fallback",
    PASSPORT_CLAIM = "passport_claim",
    PRESTIGE_STAR = "prestige_star",
    CHAIN_COMPLETE = "chain_complete",
    BOUNTY_CLAIM = "bounty_claim",
    EMPORIUM_PURCHASE = "emporium_purchase",
}

export enum GuildChainStatus {
    IN_PROGRESS = "in_progress",
    COMPLETED = "completed",
}

export type GuildChainKey =
    | "pathfinders_arc"
    | "curators_arc"
    | "relic_hunters_arc";

/** Arc-exclusive final cosmetics granted when Stage 3 is claimed (design 4). */
export const GUILD_CHAIN_FINAL_REWARDS: Record<
    GuildChainKey,
    readonly string[]
> = {
    pathfinders_arc: ["title_pathfinder", "decor_compass_rose"],
    curators_arc: ["title_curator_prime", "decor_curators_shelf"],
    relic_hunters_arc: ["title_relic_warden", "decor_relic_plinth"],
};

/** Cosmetics granted once on crossing each Rank threshold (design 2). */
export const GUILD_RANK_PROMOTION_REWARDS: Record<
    GuildRank,
    readonly string[]
> = {
    [GuildRank.E]: [],
    [GuildRank.D]: ["title_guild_initiate", "frame_copper_compass"],
    [GuildRank.C]: ["title_field_scout", "decor_tavern_lantern"],
    [GuildRank.B]: ["frame_forged_steel", "decor_sleeping_cat"],
    [GuildRank.A]: ["title_master_adventurer", "license_gilded_ledger"],
    [GuildRank.S]: ["frame_astral_crown", "title_guild_legend"],
};

export interface GuildRankPerks {
    maxActiveContracts: number;
    weeklyRerolls: number;
    monthlyExpedition: boolean;
    /** Rank A+ includes Rank S templates in the Monthly Expedition pool. */
    monthlyExpeditionRankS: boolean;
    monthlyFreeHourglass: number;
    legendaryContracts: boolean;
}

/** Cumulative functional perks per rank (spec: profile-and-ranks). */
export const GUILD_RANK_PERKS: Record<GuildRank, GuildRankPerks> = {
    [GuildRank.E]: {
        maxActiveContracts: GUILD_MAX_ACTIVE_CONTRACTS,
        weeklyRerolls: 0,
        monthlyExpedition: false,
        monthlyExpeditionRankS: false,
        monthlyFreeHourglass: 0,
        legendaryContracts: false,
    },
    [GuildRank.D]: {
        maxActiveContracts: GUILD_MAX_ACTIVE_CONTRACTS,
        weeklyRerolls: 1,
        monthlyExpedition: false,
        monthlyExpeditionRankS: false,
        monthlyFreeHourglass: 0,
        legendaryContracts: false,
    },
    [GuildRank.C]: {
        maxActiveContracts: GUILD_MAX_ACTIVE_CONTRACTS,
        weeklyRerolls: 1,
        monthlyExpedition: true,
        monthlyExpeditionRankS: false,
        monthlyFreeHourglass: 0,
        legendaryContracts: false,
    },
    [GuildRank.B]: {
        maxActiveContracts: GUILD_MAX_ACTIVE_CONTRACTS_RANK_B,
        weeklyRerolls: 1,
        monthlyExpedition: true,
        monthlyExpeditionRankS: false,
        monthlyFreeHourglass: 0,
        legendaryContracts: false,
    },
    [GuildRank.A]: {
        maxActiveContracts: GUILD_MAX_ACTIVE_CONTRACTS_RANK_B,
        weeklyRerolls: 1,
        monthlyExpedition: true,
        monthlyExpeditionRankS: true,
        monthlyFreeHourglass: 1,
        legendaryContracts: false,
    },
    [GuildRank.S]: {
        maxActiveContracts: GUILD_MAX_ACTIVE_CONTRACTS_RANK_B,
        weeklyRerolls: 2,
        monthlyExpedition: true,
        monthlyExpeditionRankS: true,
        monthlyFreeHourglass: 1,
        legendaryContracts: true,
    },
};

export const getGuildRankPerks = (rank: GuildRank): GuildRankPerks =>
    GUILD_RANK_PERKS[rank] ?? GUILD_RANK_PERKS[GuildRank.E];

export type GuildChestTierKey =
    | GuildRewardKind.CHEST_BRONZE
    | GuildRewardKind.CHEST_SILVER
    | GuildRewardKind.CHEST_GOLD
    | GuildRewardKind.CHEST_RELIC;

/** `weekly_chest` stays valid for old contracts and opens as a Silver chest. */
export type GuildChestKind = GuildChestTierKey | GuildRewardKind.WEEKLY_CHEST;

export interface GuildChestTierConfig {
    kind: GuildChestTierKey;
    bonusXp: number;
    bonusSeals: number;
    poolRarities: readonly GuildRewardRarity[];
    /** Checked only when the tier's own pool is exhausted. */
    fallbackRarities: readonly GuildRewardRarity[];
    consumableDropChance: number;
    consumableKeys: readonly GuildConsumableKey[];
    /** Cosmetic slot converts to these rewards when every pool rarity is owned. */
    exhaustedBonusXp: number;
    exhaustedBonusSeals: number;
}

export const GUILD_CHEST_TIERS: Record<
    GuildChestTierKey,
    GuildChestTierConfig
> = {
    [GuildRewardKind.CHEST_BRONZE]: {
        kind: GuildRewardKind.CHEST_BRONZE,
        bonusXp: 40,
        bonusSeals: 15,
        poolRarities: [GuildRewardRarity.COMMON],
        fallbackRarities: [],
        consumableDropChance: 0,
        consumableKeys: [],
        exhaustedBonusXp: 50,
        exhaustedBonusSeals: 25,
    },
    [GuildRewardKind.CHEST_SILVER]: {
        kind: GuildRewardKind.CHEST_SILVER,
        bonusXp: 75,
        bonusSeals: 30,
        poolRarities: [GuildRewardRarity.UNCOMMON],
        fallbackRarities: [GuildRewardRarity.COMMON],
        consumableDropChance: 0,
        consumableKeys: [],
        exhaustedBonusXp: 50,
        exhaustedBonusSeals: 45,
    },
    [GuildRewardKind.CHEST_GOLD]: {
        kind: GuildRewardKind.CHEST_GOLD,
        bonusXp: 125,
        bonusSeals: 60,
        poolRarities: [GuildRewardRarity.RARE],
        fallbackRarities: [GuildRewardRarity.UNCOMMON],
        consumableDropChance: 0.35,
        consumableKeys: [
            GuildConsumableKey.HOURGLASS,
            GuildConsumableKey.REROLL_CHARTER,
        ],
        exhaustedBonusXp: 50,
        exhaustedBonusSeals: 80,
    },
    [GuildRewardKind.CHEST_RELIC]: {
        kind: GuildRewardKind.CHEST_RELIC,
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
        exhaustedBonusXp: 50,
        exhaustedBonusSeals: 150,
    },
};

/** Bronze -> Silver -> Gold -> Relic; bonus objectives upgrade one step. */
export const GUILD_CHEST_UPGRADE_LADDER: readonly GuildChestTierKey[] = [
    GuildRewardKind.CHEST_BRONZE,
    GuildRewardKind.CHEST_SILVER,
    GuildRewardKind.CHEST_GOLD,
    GuildRewardKind.CHEST_RELIC,
];

export const resolveGuildChestTier = (
    kind: GuildChestKind,
): GuildChestTierConfig =>
    kind === GuildRewardKind.WEEKLY_CHEST
        ? GUILD_CHEST_TIERS[GuildRewardKind.CHEST_SILVER]
        : (GUILD_CHEST_TIERS[kind as GuildChestTierKey] ??
          GUILD_CHEST_TIERS[GuildRewardKind.CHEST_BRONZE]);

export const upgradeGuildChestTier = (
    kind: GuildChestKind,
): GuildChestTierKey => {
    const current =
        kind === GuildRewardKind.WEEKLY_CHEST
            ? GuildRewardKind.CHEST_SILVER
            : kind;
    const index = GUILD_CHEST_UPGRADE_LADDER.indexOf(current);
    return GUILD_CHEST_UPGRADE_LADDER[
        Math.min(index + 1, GUILD_CHEST_UPGRADE_LADDER.length - 1)
    ];
};

export enum LinaTrigger {
    CONTRACT_ACCEPTED = "contract_accepted",
    CONTRACT_CLAIMED = "contract_claimed",
    CONTRACT_READY_TO_CLAIM = "contract_ready_to_claim",
    RETURNING_AFTER_INACTIVITY = "returning_after_inactivity",
    WEEKLY_BOARD_REFRESHED = "weekly_board_refreshed",
    STALE_BACKLOG_GAME = "stale_backlog_game",
    RANK_PROMOTED = "rank_promoted",
    CHAIN_COMPLETED = "chain_completed",
    COMMUNITY_BOUNTY_READY = "community_bounty_ready",
    MONTHLY_EXPEDITION_REFRESHED = "monthly_expedition_refreshed",
    DEFAULT = "default",
}

export enum LinaPose {
    HAPPY = "happy",
    NEUTRAL = "neutral",
}

export enum GuildLocale {
    EN = "en",
    PT_BR = "pt-BR",
}

/** Objective filters stored as `criteria` on events, board entries and contracts. */
export type GuildCriteria = {
    gameIds?: number[];
    genreIds?: number[];
    themeIds?: number[];
    keywordIds?: number[];
    franchiseIds?: number[];
    platformIds?: number[];
    /** IGDB `game.category` values; 0 is a main game, so zero is allowed here. */
    gameCategories?: number[];
    maxTimeToBeatHours?: number;
    minTimeToBeatHours?: number;
    releaseYearMin?: number;
    releaseYearMax?: number;
    indieOnly?: boolean;
    finishedInCurrentMonth?: boolean;
    minReviewChars?: number;
    minPlaytimeSecondsPerGame?: number;
    /** `log_playtime`: only games currently in this library status (e.g. `planned`). */
    status?: CollectionEntryStatus;
    minPostChars?: number;
    minCollectionEntries?: number;
    requireNoDailyHint?: boolean;
    maxDailyAttempts?: number;
};

export type GuildBonusObjectiveType =
    | "also_write_review"
    | "finish_before_half_deadline"
    | "use_stale_backlog_game";

/** Optional secondary contract objective; never blocks base completion (design 4). */
export type GuildBonusObjective = {
    type: GuildBonusObjectiveType;
    /** `also_write_review`: minimum plain-text review length. */
    minChars?: number;
    /** `use_stale_backlog_game`: backlog age that qualifies the target. */
    staleDays?: number;
    bonusXp?: number;
    bonusSeals?: number;
    /** Upgrades the contract chest by one tier on claim. */
    upgradeChestTier?: boolean;
};

// IGDB stores protocol-relative URLs with the size in the path, like daily.service.
export const igdbImageUrl = (url: string | undefined, size: string) => {
    if (!url) return null;
    const sized = url.replace(/\/t_[a-z0-9_]+\//, `/${size}/`);
    return sized.startsWith("//") ? `https:${sized}` : sized;
};

export const toRewardDescriptor = (
    reward: GuildReward,
): GuildRewardDescriptorDto => ({
    id: reward.id,
    key: reward.key,
    kind: reward.kind,
    achievementId: reward.achievementId,
    inChestPool: reward.inChestPool,
    chestBonusXp: reward.chestBonusXp,
    chestBonusSeals: reward.chestBonusSeals,
    rarity: reward.rarity,
    consumableKey: reward.consumableKey,
});

/**
 * Deterministic rotation order: sha256(seedHex + ":" + key(item)).
 * A string seed is used as the hex digest; equal keys keep their input order.
 */
export function seededOrder<T>(
    seed: Buffer | string,
    items: readonly T[],
    key: (item: T) => string | number,
): T[] {
    const seedHex = typeof seed === "string" ? seed : seed.toString("hex");
    return items
        .map((item) => ({
            item,
            order: createHash("sha256")
                .update(`${seedHex}:${key(item)}`)
                .digest("hex"),
        }))
        .sort((a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1))
        .map(({ item }) => item);
}

/** Monday of the current São Paulo week, as "YYYY-MM-DD". */
export const currentWeekStart = (now = new Date()) => mondayOf(dailyToday(now));

/**
 * Monday 00:00 São Paulo of `weekStart` as an instant.
 * shortcut: fixed UTC-3 offset, like daily.constants; derive it from DAILY_TIME_ZONE if DST returns.
 */
export const weekStartToUtcDate = (weekStart: string) =>
    new Date(`${weekStart}T00:00:00-03:00`);

/** When the board of `weekStart` refreshes: the next Monday 00:00 São Paulo. */
export const nextMondayRefreshAt = (weekStart: string) =>
    weekStartToUtcDate(addDays(weekStart, 7));

/** Current São Paulo month, as "YYYY-MM" (Monthly Expeditions, Emporium, Passport). */
export const currentMonthKey = (now = new Date()) =>
    dailyToday(now).slice(0, 7);

/** First day of the next São Paulo month at 00:00, as an instant. */
export const nextMonthResetAt = (now = new Date()) => {
    const [year, month] = currentMonthKey(now).split("-").map(Number);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return new Date(
        `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00-03:00`,
    );
};
