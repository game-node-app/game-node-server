import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, In, LessThanOrEqual, MoreThan } from "typeorm";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import {
    GuildBoardCandidateGame,
    GuildBoardEntry,
} from "./entities/guild-board-entry.entity";
import { GuildEvent } from "./entities/guild-event.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import {
    currentWeekStart,
    GuildCategory,
    GuildContractStatus,
    GuildEventStatus,
    GuildRank,
    nextMondayRefreshAt,
} from "./guild.constants";
import {
    GUILD_SYSTEM_TEMPLATES,
    GuildQuestTemplate,
} from "./guild-templates.constants";
import {
    GuildTimeToBeatService,
    getEffectiveTtbSeconds,
} from "./guild-time-to-beat.service";
import {
    GuildBoardCandidateGameDto,
    GuildBoardEventTranslationDto,
    GuildBoardQuestDto,
    GuildBoardResponseDto,
} from "./dto/guild-board.dto";
import { GuildRewardDescriptorDto } from "./dto/guild-rewards.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A planned/dropped game untouched for this long is a stale backlog relic. */
const STALE_BACKLOG_DAYS = 365;

/** Design 3: candidate chips only for games at most 8 hours long. */
const SHORT_GAME_MAX_SECONDS = 8 * 60 * 60;

/** Up to 3 chips per quest. */
const CANDIDATE_LIMIT = 3;

/** Most library games whose TTB is inspected per weekly generation. */
const WEEKLY_LIBRARY_LIMIT = 40;

const TEMPLATE_BY_KEY = new Map(
    GUILD_SYSTEM_TEMPLATES.map((template) => [template.key, template]),
);

const RANK_ORDER: Record<GuildRank, number> = {
    [GuildRank.E]: 0,
    [GuildRank.D]: 1,
    [GuildRank.C]: 2,
    [GuildRank.B]: 3,
    [GuildRank.A]: 4,
    [GuildRank.S]: 5,
};

// IGDB stores protocol-relative URLs with the size in the path, like daily.service.
const igdbImageUrl = (url: string | undefined, size: string) => {
    if (!url) return null;
    const sized = url.replace(/\/t_[a-z0-9_]+\//, `/${size}/`);
    return sized.startsWith("//") ? `https:${sized}` : sized;
};

const weekSeed = (userId: string, weekStart: string) =>
    createHash("sha256").update(`${userId}:${weekStart}`).digest();

const template = (key: string) => TEMPLATE_BY_KEY.get(key)!;

const toRewardDescriptor = (reward: GuildReward): GuildRewardDescriptorDto => ({
    id: reward.id,
    key: reward.key,
    kind: reward.kind,
    achievementId: reward.achievementId,
    inChestPool: reward.inChestPool,
    chestBonusXp: reward.chestBonusXp,
});

interface BoardSlot {
    slotIndex: number;
    template: GuildQuestTemplate;
    candidateGames: GuildBoardCandidateGame[];
}

interface GameChip {
    name: string;
    slug: string;
    coverUrl: string | null;
}

export interface GetGuildBoardOptions {
    quick?: boolean;
    now?: Date;
}

/**
 * Builds each user's persisted Monday quest board and merges active curated
 * events on read, so publishing or archiving takes effect immediately (design 3).
 */
@Injectable()
export class GuildBoardService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly guildTimeToBeatService: GuildTimeToBeatService,
    ) {}

    public async ensureWeeklyEntries(
        userId: string,
        now = new Date(),
    ): Promise<GuildBoardEntry[]> {
        const weekStart = currentWeekStart(now);
        const repository = this.dataSource.getRepository(GuildBoardEntry);
        const existing = await repository.find({
            where: { profileUserId: userId, weekStart },
            relations: { reward: true },
            order: { slotIndex: "ASC" },
        });
        if (existing.length > 0) return existing;

        const seed = weekSeed(userId, weekStart);
        const gamenodeTemplate =
            seed[0] % 2 === 0
                ? template("captains_log")
                : template("on_duty_critic");
        const shortGames = await this.shortGameCandidates(userId, now);
        const weeklyTemplate =
            shortGames.length > 0
                ? template("short_caravan")
                : template("weekend_sprint");
        const librarySlot = await this.librarySlot(
            userId,
            now,
            [weeklyTemplate, gamenodeTemplate],
            seed,
        );

        const slots: BoardSlot[] = [
            { slotIndex: 0, ...librarySlot },
            {
                slotIndex: 1,
                template: weeklyTemplate,
                candidateGames: shortGames,
            },
            {
                slotIndex: 2,
                template: gamenodeTemplate,
                candidateGames: [],
            },
        ];
        const rewardIds = await this.rewardIdsByKey(
            slots.map((slot) => slot.template.rewardKey),
        );
        const expiresAt = nextMondayRefreshAt(weekStart);

        // INSERT IGNORE keeps concurrent same-week generation idempotent (UQ user/week/slot).
        for (const slot of slots) {
            await this.dataSource.query(
                `INSERT IGNORE INTO guild_board_entry
                    (id, profileUserId, weekStart, slotIndex, category, templateKey, \`rank\`, xpReward,
                     objectiveType, targetCount, criteria, candidateGames, requiresTargetGame, rewardId,
                     isRecommended, isQuick, expiresAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                [
                    randomUUID(),
                    userId,
                    weekStart,
                    slot.slotIndex,
                    slot.template.category,
                    slot.template.key,
                    slot.template.rank,
                    slot.template.xpReward,
                    slot.template.objectiveType,
                    slot.template.targetCount,
                    JSON.stringify(slot.template.criteria),
                    JSON.stringify(slot.candidateGames),
                    slot.template.requiresTargetGame,
                    rewardIds.get(slot.template.rewardKey ?? "") ?? null,
                    slot.template.isQuick,
                    expiresAt,
                ],
            );
        }

        return repository.find({
            where: { profileUserId: userId, weekStart },
            relations: { reward: true },
            order: { slotIndex: "ASC" },
        });
    }

    public async getBoard(
        userId: string,
        options: GetGuildBoardOptions = {},
    ): Promise<GuildBoardResponseDto> {
        const now = options.now ?? new Date();
        const weekStart = currentWeekStart(now);
        const entries = await this.ensureWeeklyEntries(userId, now);
        const events = await this.activeEvents(now);
        const excluded = await this.excludedQuestKeys(userId, entries, events);

        const openEntries = entries.filter(
            (entry) => !excluded.boardEntryIds.has(entry.id),
        );
        const openEvents = events.filter(
            (event) => !excluded.eventIds.has(event.id),
        );
        const chips = await this.gameChips(
            openEntries.flatMap((entry) => entry.candidateGames ?? []),
        );

        const quests: GuildBoardQuestDto[] = [
            ...openEntries.map((entry) => this.entryToQuest(entry, chips)),
            ...openEvents.map((event) => this.eventToQuest(event)),
        ];
        this.applyRecommendation(quests);

        if (!options.quick)
            return {
                weekStart,
                nextRefreshAt: nextMondayRefreshAt(weekStart),
                quests,
            };

        return {
            weekStart,
            nextRefreshAt: nextMondayRefreshAt(weekStart),
            quests: quests
                .filter((quest) => quest.isQuick)
                .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]),
        };
    }

    /** Open quest count for `GET /v1/guild`, sharing the board's exclusion rules. */
    public async getOpenBoardCount(
        userId: string,
        now = new Date(),
    ): Promise<number> {
        return (await this.getBoard(userId, { now })).quests.length;
    }

    private async shortGameCandidates(
        userId: string,
        now: Date,
    ): Promise<GuildBoardCandidateGame[]> {
        const rows: Array<{ gameId: number }> = await this.dataSource.query(
            `SELECT ce.gameId
             FROM collection_entry ce
             WHERE ce.libraryUserId = ? AND ce.status IN (?, ?)
             ORDER BY COALESCE(ce.plannedAt, ce.createdAt) DESC, ce.gameId ASC
             LIMIT ?`,
            [
                userId,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.PLAYING,
                WEEKLY_LIBRARY_LIMIT,
            ],
        );
        const gameIds = rows.map((row) => Number(row.gameId));
        if (gameIds.length === 0) return [];

        const ttbByGameId = await this.guildTimeToBeatService.getForGameIds(
            gameIds,
            now,
        );
        return gameIds
            .map((gameId) => ({
                gameId,
                seconds: getEffectiveTtbSeconds(ttbByGameId.get(gameId)),
            }))
            .filter(
                (
                    item,
                ): item is {
                    gameId: number;
                    seconds: number;
                } =>
                    item.seconds !== null &&
                    item.seconds > 0 &&
                    item.seconds <= SHORT_GAME_MAX_SECONDS,
            )
            .slice(0, CANDIDATE_LIMIT)
            .map(({ gameId, seconds }) => ({
                gameId,
                estimatedHours: Math.max(1, Math.round(seconds / 3_600)),
            }));
    }

    private async librarySlot(
        userId: string,
        now: Date,
        usedTemplates: GuildQuestTemplate[],
        seed: Buffer,
    ): Promise<Omit<BoardSlot, "slotIndex">> {
        const stale = await this.staleBacklogCandidates(userId, now);
        if (stale.length > 0) {
            return {
                template: template("forgotten_relic"),
                candidateGames: stale,
            };
        }

        const playing = await this.playingCandidates(userId);
        if (playing.length > 0) {
            return {
                template: template("deep_dive"),
                candidateGames: playing,
            };
        }

        // Empty library: an unused weekly/gamenode template replaces the library slot.
        const used = new Set(usedTemplates.map((item) => item.key));
        const fallback = GUILD_SYSTEM_TEMPLATES.filter(
            (item) =>
                !used.has(item.key) &&
                (item.category === GuildCategory.WEEKLY ||
                    item.category === GuildCategory.GAMENODE),
        );
        return {
            template: fallback[seed[1] % fallback.length],
            candidateGames: [],
        };
    }

    private async staleBacklogCandidates(
        userId: string,
        now: Date,
    ): Promise<GuildBoardCandidateGame[]> {
        const cutoff = new Date(now.getTime() - STALE_BACKLOG_DAYS * DAY_MS);
        const rows: Array<{ gameId: number; sinceYear: number }> =
            await this.dataSource.query(
                `SELECT ce.gameId, YEAR(COALESCE(ce.plannedAt, ce.createdAt)) AS sinceYear
                 FROM collection_entry ce
                 WHERE ce.libraryUserId = ? AND ce.status IN (?, ?)
                   AND COALESCE(ce.plannedAt, ce.createdAt) < ?
                   AND NOT EXISTS (
                       SELECT 1 FROM user_playtime up
                       WHERE up.profileUserId = ce.libraryUserId
                         AND up.gameId = ce.gameId
                         AND up.lastPlayedDate >= ?
                   )
                 ORDER BY COALESCE(ce.plannedAt, ce.createdAt) ASC, ce.gameId ASC
                 LIMIT ?`,
                [
                    userId,
                    CollectionEntryStatus.PLANNED,
                    CollectionEntryStatus.DROPPED,
                    cutoff,
                    cutoff,
                    CANDIDATE_LIMIT,
                ],
            );
        return rows.map((row) => ({
            gameId: Number(row.gameId),
            sinceYear: Number(row.sinceYear),
        }));
    }

    private async playingCandidates(
        userId: string,
    ): Promise<GuildBoardCandidateGame[]> {
        const rows: Array<{ gameId: number }> = await this.dataSource.query(
            `SELECT ce.gameId
             FROM collection_entry ce
             WHERE ce.libraryUserId = ? AND ce.status = ?
             ORDER BY COALESCE(ce.startedAt, ce.createdAt) DESC, ce.gameId ASC
             LIMIT ?`,
            [userId, CollectionEntryStatus.PLAYING, CANDIDATE_LIMIT],
        );
        return rows.map((row) => ({ gameId: Number(row.gameId) }));
    }

    private async rewardIdsByKey(
        keys: Array<string | null>,
    ): Promise<Map<string, string>> {
        const uniqueKeys = [
            ...new Set(keys.filter((key): key is string => key !== null)),
        ];
        if (uniqueKeys.length === 0) return new Map();

        const rewards = await this.dataSource
            .getRepository(GuildReward)
            .find({ where: { key: In(uniqueKeys) } });
        return new Map(rewards.map((reward) => [reward.key, reward.id]));
    }

    private activeEvents(now: Date): Promise<GuildEvent[]> {
        return this.dataSource.getRepository(GuildEvent).find({
            where: {
                status: GuildEventStatus.PUBLISHED,
                startsAt: LessThanOrEqual(now),
                endsAt: MoreThan(now),
            },
            relations: { translations: true, reward: true },
            order: { startsAt: "ASC", id: "ASC" },
        });
    }

    /** Contracts that close a quest: abandoned/expired leave it open (spec: quest board). */
    private async excludedQuestKeys(
        userId: string,
        entries: GuildBoardEntry[],
        events: GuildEvent[],
    ): Promise<{ boardEntryIds: Set<string>; eventIds: Set<string> }> {
        const boardEntryIds = entries.map((entry) => entry.id);
        const eventIds = events.map((event) => event.id);
        const closedBoardEntryIds = new Set<string>();
        const closedEventIds = new Set<string>();

        if (boardEntryIds.length > 0 || eventIds.length > 0) {
            const clauses: string[] = [];
            const parameters: unknown[] = [
                userId,
                GuildContractStatus.ACTIVE,
                GuildContractStatus.READY_TO_CLAIM,
                GuildContractStatus.COMPLETED,
            ];
            if (boardEntryIds.length > 0) {
                clauses.push(
                    `boardEntryId IN (${boardEntryIds.map(() => "?").join(",")})`,
                );
                parameters.push(...boardEntryIds);
            }
            if (eventIds.length > 0) {
                clauses.push(
                    `eventId IN (${eventIds.map(() => "?").join(",")})`,
                );
                parameters.push(...eventIds);
            }
            const rows: Array<{
                boardEntryId: string | null;
                eventId: string | null;
            }> = await this.dataSource.query(
                `SELECT boardEntryId, eventId FROM guild_contract
                 WHERE profileUserId = ? AND status IN (?, ?, ?)
                   AND (${clauses.join(" OR ")})`,
                parameters,
            );
            for (const row of rows) {
                if (row.boardEntryId) closedBoardEntryIds.add(row.boardEntryId);
                if (row.eventId) closedEventIds.add(row.eventId);
            }
        }

        return {
            boardEntryIds: closedBoardEntryIds,
            eventIds: closedEventIds,
        };
    }

    private async gameChips(
        candidates: GuildBoardCandidateGame[],
    ): Promise<Map<number, GameChip>> {
        const gameIds = [...new Set(candidates.map((game) => game.gameId))];
        if (gameIds.length === 0) return new Map();

        const rows: Array<{
            id: number;
            name: string;
            slug: string;
            coverUrl: string | null;
        }> = await this.dataSource.query(
            `SELECT g.id, g.name, g.slug, gc.url AS coverUrl
             FROM game g
             LEFT JOIN game_cover gc ON gc.gameId = g.id
             WHERE g.id IN (${gameIds.map(() => "?").join(",")})`,
            gameIds,
        );
        return new Map(
            rows.map((row) => [
                Number(row.id),
                {
                    name: row.name,
                    slug: row.slug,
                    coverUrl: igdbImageUrl(
                        row.coverUrl ?? undefined,
                        "t_cover_big",
                    ),
                },
            ]),
        );
    }

    private entryToQuest(
        entry: GuildBoardEntry,
        chips: Map<number, GameChip>,
    ): GuildBoardQuestDto {
        const candidateGames = (entry.candidateGames ?? []).map((candidate) => {
            const game = chips.get(candidate.gameId);
            return {
                gameId: candidate.gameId,
                ...(game
                    ? {
                          name: game.name,
                          slug: game.slug,
                          coverUrl: game.coverUrl,
                      }
                    : {}),
                ...(candidate.sinceYear !== undefined
                    ? { sinceYear: candidate.sinceYear }
                    : {}),
                ...(candidate.estimatedHours !== undefined
                    ? { estimatedHours: candidate.estimatedHours }
                    : {}),
            };
        });
        const sinceYear = candidateGames[0]?.sinceYear ?? null;

        return {
            sourceType: "board_entry",
            boardEntryId: entry.id,
            eventId: null,
            slug: null,
            category: entry.category,
            templateKey: entry.templateKey,
            title: null,
            description: null,
            translations: [],
            rank: entry.rank,
            xpReward: entry.xpReward,
            objectiveType: entry.objectiveType,
            targetCount: entry.targetCount,
            criteria: entry.criteria,
            candidateGames,
            meta:
                entry.templateKey === "forgotten_relic" && sinceYear !== null
                    ? { sinceYear }
                    : null,
            requiresTargetGame: entry.requiresTargetGame,
            reward: entry.reward ? toRewardDescriptor(entry.reward) : null,
            isRecommended: false,
            isQuick: entry.isQuick,
            expiresAt: entry.expiresAt,
        };
    }

    private eventToQuest(event: GuildEvent): GuildBoardQuestDto {
        const translations: GuildBoardEventTranslationDto[] = [
            ...(event.translations ?? []),
        ]
            .sort((a, b) => a.locale.localeCompare(b.locale))
            .map((translation) => ({
                locale: translation.locale,
                title: translation.title,
                description: translation.description,
            }));

        return {
            sourceType: "event",
            boardEntryId: null,
            eventId: event.id,
            slug: event.slug,
            category: GuildCategory.EVENT,
            templateKey: null,
            title: event.title,
            description: event.description,
            translations,
            rank: event.rank,
            xpReward: event.xpReward,
            objectiveType: event.objectiveType,
            targetCount: event.targetCount,
            criteria: event.criteria,
            candidateGames: [],
            meta: null,
            requiresTargetGame: false,
            reward: event.reward ? toRewardDescriptor(event.reward) : null,
            isRecommended: false,
            isQuick: event.rank === GuildRank.E || event.rank === GuildRank.D,
            expiresAt: event.endsAt,
        };
    }

    /** Stale backlog first, then an active event, then the first weekly quest (spec). */
    private applyRecommendation(quests: GuildBoardQuestDto[]): void {
        const recommended =
            quests.find(
                (quest) =>
                    quest.sourceType === "board_entry" &&
                    quest.category === GuildCategory.LIBRARY &&
                    quest.templateKey === "forgotten_relic",
            ) ??
            quests.find((quest) => quest.sourceType === "event") ??
            quests.find((quest) => quest.category === GuildCategory.WEEKLY);
        if (recommended) recommended.isRecommended = true;
    }
}
