import { createHash } from "node:crypto";
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

export const GUILD_MAX_ACTIVE_CONTRACTS = 3;

/** Awarded in place of a title or frame the user already owns (spec: rewards). */
export const DUPLICATE_COSMETIC_BONUS_XP = 50;

/** Share of claimed Guild XP also credited to the global UserLevel (design 13). */
export const GUILD_GLOBAL_XP_MULTIPLIER = 0.25;

/** Trimmed review length that proves the reviewer actually played the game. */
export const GUILD_MIN_REVIEW_CHARS = 80;

/** Days without a Guild visit that trigger Lina's "returning" reception. */
export const GUILD_INACTIVITY_DAYS = 30;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** A planned/dropped game untouched for this long is a stale backlog relic. */
export const STALE_BACKLOG_DAYS = 365;

export enum GuildCategory {
    LIBRARY = "library",
    EVENT = "event",
    WEEKLY = "weekly",
    GAMENODE = "gamenode",
}

export enum GuildObjectiveType {
    FINISH_GAME = "finish_game",
    WRITE_REVIEW = "write_review",
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

export enum GuildRewardKind {
    BADGE = "badge",
    TITLE = "title",
    AVATAR_FRAME = "avatar_frame",
    WEEKLY_CHEST = "weekly_chest",
}

export enum LinaTrigger {
    CONTRACT_ACCEPTED = "contract_accepted",
    CONTRACT_CLAIMED = "contract_claimed",
    CONTRACT_READY_TO_CLAIM = "contract_ready_to_claim",
    RETURNING_AFTER_INACTIVITY = "returning_after_inactivity",
    WEEKLY_BOARD_REFRESHED = "weekly_board_refreshed",
    STALE_BACKLOG_GAME = "stale_backlog_game",
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
    maxTimeToBeatHours?: number;
    finishedInCurrentMonth?: boolean;
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
