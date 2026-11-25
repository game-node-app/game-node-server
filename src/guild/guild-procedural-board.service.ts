import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { GuildBoardCandidateGame } from "./entities/guild-board-entry.entity";
import {
    ANCIENT_FOSSIL_DAYS,
    currentMonthKey,
    DAY_MS,
    getGuildRankPerks,
    GuildBoardCycle,
    GuildCriteria,
    GuildRank,
    guildRankAtLeast,
    nextMonthResetAt,
    RECENT_DUST_DAYS,
    seededOrder,
    STALE_BACKLOG_DAYS,
} from "./guild.constants";
import {
    GUILD_SYSTEM_TEMPLATES,
    GuildQuestTemplate,
} from "./guild-templates.constants";
import {
    getEffectiveTtbSeconds,
    GuildTimeToBeatService,
} from "./guild-time-to-beat.service";

/** Up to 3 candidate chips per quest. */
const CANDIDATE_LIMIT = 3;

/** shortcut: library-DNA scans the oldest 500 unfinished entries; upgrade for 5,000+ game backlogs. */
const LIBRARY_SCAN_LIMIT = 500;

/** Most recent backlog games warmed for short_caravan, matching the weekly board's IGDB budget. */
const SHORT_GAME_SCAN_LIMIT = 40;

/** Games with fewer ratings (or none) are obscure enough to be hidden gems. */
const LOW_POPULARITY_RATING_COUNT = 100;

/** IGDB's Indie genre; games in it always qualify as hidden gems. */
const INDIE_GENRE_ID = 32;

/** Games planned for at least this long are triageable by pack_cleanup. */
const BACKLOG_TRIAGE_DAYS = 30;

/** "Libraries older than 2 years" for the ancient_fossil veteran branch. */
const VETERAN_LIBRARY_DAYS = 730;

const TEMPLATE_BY_KEY = new Map(
    GUILD_SYSTEM_TEMPLATES.map((template) => [template.key, template]),
);

/** Templates every member can always complete; no library DNA needed. */
const ALWAYS_ELIGIBLE_TEMPLATE_KEYS = new Set([
    "weekend_sprint",
    "double_feature",
    "field_vigil",
    "campaign_rhythm",
    "quick_take",
    "on_duty_critic",
    "deep_critic",
    "guild_oracle",
    "eagle_eye",
    "cartographer",
    "expedition_log",
    "deep_critic_anthology",
]);

/** Templates that need synced Steam/PSN/Xbox achievements or completions. */
const SYNCED_ACHIEVEMENT_TEMPLATE_KEYS = new Set([
    "trophy_hunter",
    "platinum_crown",
]);

export interface GuildProceduralBoardOptions {
    now?: Date;
    /** Deterministic rotation seed; defaults to `sha256(userId + ":" + templateKey)`. */
    seed?: Buffer | string;
}

/** Synthesized rules for one quest; `null` from the resolver means ineligible. */
export interface GuildProceduralQuest {
    eligible: boolean;
    criteria: GuildCriteria;
    candidateGames: GuildBoardCandidateGame[];
    meta: Record<string, unknown> | null;
}

export interface GuildResolvedTemplate extends GuildProceduralQuest {
    template: GuildQuestTemplate;
}

export interface GuildMonthlyExpedition extends GuildResolvedTemplate {
    slotIndex: 3;
    cycle: GuildBoardCycle;
    periodKey: string;
}

interface LibraryGame {
    gameId: number;
    status: CollectionEntryStatus;
    addedAt: Date;
    startedAt: Date | null;
    lastPlayedAt: Date | null;
    releasedAt: Date | null;
    ratingCount: number | null;
    genreIds: number[];
    franchiseIds: number[];
    themeIds: number[];
}

interface LibraryDna {
    userId: string;
    unfinished: LibraryGame[];
    playing: LibraryGame[];
    finishedGenreCounts: Map<number, number>;
    finishedFranchiseIds: Set<number>;
    finishedThisMonth: number[];
    libraryAgeDays: number;
}

const parseIds = (value: string | null): number[] =>
    value ? String(value).split(",").map(Number) : [];

const groupBy = <K, T>(items: readonly T[], key: (item: T) => K) => {
    const groups = new Map<K, T[]>();
    for (const item of items) {
        const groupKey = key(item);
        const group = groups.get(groupKey);
        if (group) group.push(item);
        else groups.set(groupKey, [item]);
    }
    return groups;
};

/**
 * Synthesizes library-DNA quests (procedural criteria and candidate chips) and
 * Monthly Expeditions deterministically, without ever failing board generation
 * (design 8). Ineligible templates return null so the caller picks another one.
 */
@Injectable()
export class GuildProceduralBoardService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly guildTimeToBeatService: GuildTimeToBeatService,
    ) {}

    /** Weekly and monthly achievement templates need synced external data (spec: quest board). */
    public async hasSyncedExternalAchievements(
        userId: string,
    ): Promise<boolean> {
        const rows: Array<{ ok: number }> = await this.dataSource.query(
            `SELECT 1 AS ok FROM obtained_game_achievement oga
                 INNER JOIN game_external_game geg ON geg.id = oga.externalGameId
                 WHERE oga.profileUserId = ?
             UNION ALL
             SELECT 1 AS ok FROM game_completion_status gcs
                 INNER JOIN game_external_game geg ON geg.id = gcs.externalGameId
                 WHERE gcs.profileUserId = ?
             LIMIT 1`,
            [userId, userId],
        );
        return rows.length > 0;
    }

    /** Resolves one template; null when it cannot be completed right now. */
    public async resolveTemplate(
        userId: string,
        template: GuildQuestTemplate,
        options: GuildProceduralBoardOptions = {},
    ): Promise<GuildResolvedTemplate | null> {
        const [resolved] = await this.resolveTemplates(
            userId,
            [template],
            options,
        );
        return resolved ?? null;
    }

    /** Resolves a template list in order, skipping ineligible ones. */
    public async resolveTemplates(
        userId: string,
        templates: readonly GuildQuestTemplate[],
        options: GuildProceduralBoardOptions = {},
    ): Promise<GuildResolvedTemplate[]> {
        const now = options.now ?? new Date();
        let library: Promise<LibraryDna> | null = null;
        const getLibrary = () => (library ??= this.loadLibraryDna(userId, now));

        const resolved: GuildResolvedTemplate[] = [];
        for (const template of templates) {
            const quest = await this.resolveQuest(
                userId,
                template,
                getLibrary,
                now,
                options.seed,
            );
            if (quest) resolved.push({ template, ...quest });
        }
        return resolved;
    }

    /** Convenience resolver by template key; null for unknown or ineligible keys. */
    public async evaluateTemplate(
        userId: string,
        templateKey: string,
        options: GuildProceduralBoardOptions = {},
    ): Promise<GuildResolvedTemplate | null> {
        const template = TEMPLATE_BY_KEY.get(templateKey);
        if (!template) return null;
        return this.resolveTemplate(userId, template, options);
    }

    /**
     * Monthly Expedition for slot 3, unlocked at Rank C. Ranks C-B roll the
     * Rank A pool; Ranks A-S add Rank S templates. Deterministic per user/month.
     */
    public async generateMonthlyExpedition(
        userId: string,
        rank: GuildRank,
        options: { now?: Date } = {},
    ): Promise<GuildMonthlyExpedition | null> {
        if (!getGuildRankPerks(rank).monthlyExpedition) return null;

        const now = options.now ?? new Date();
        const periodKey = currentMonthKey(now);
        const seed = createHash("sha256")
            .update(`${userId}:monthly:${periodKey}`)
            .digest();
        const pool = GUILD_SYSTEM_TEMPLATES.filter(
            (template) =>
                template.cycle === GuildBoardCycle.MONTHLY &&
                guildRankAtLeast(rank, template.minRank),
        );
        const eligible = await this.resolveTemplates(userId, pool, {
            now,
            seed,
        });
        if (eligible.length === 0) {
            const fallback = TEMPLATE_BY_KEY.get("deep_critic_anthology")!;
            return {
                slotIndex: 3,
                cycle: GuildBoardCycle.MONTHLY,
                periodKey,
                template: fallback,
                eligible: true,
                criteria: { ...fallback.criteria },
                candidateGames: [],
                meta: null,
            };
        }

        const winner = seededOrder(
            seed,
            eligible,
            (item) => item.template.key,
        )[0];
        return {
            ...winner,
            slotIndex: 3,
            cycle: GuildBoardCycle.MONTHLY,
            periodKey,
        };
    }

    private async resolveQuest(
        userId: string,
        template: GuildQuestTemplate,
        getLibrary: () => Promise<LibraryDna>,
        now: Date,
        seedOption?: Buffer | string,
    ): Promise<GuildProceduralQuest | null> {
        const seed =
            seedOption ??
            createHash("sha256").update(`${userId}:${template.key}`).digest();

        if (SYNCED_ACHIEVEMENT_TEMPLATE_KEYS.has(template.key))
            return (await this.hasSyncedExternalAchievements(userId))
                ? this.quest(template.criteria, [], null)
                : null;

        if (ALWAYS_ELIGIBLE_TEMPLATE_KEYS.has(template.key))
            return this.quest(template.criteria, [], null);

        const dna = await getLibrary();
        switch (template.key) {
            case "recent_dust":
                return this.staleQuest(
                    template.criteria,
                    dna,
                    now,
                    seed,
                    RECENT_DUST_DAYS,
                );
            case "forgotten_relic":
                return this.staleQuest(
                    template.criteria,
                    dna,
                    now,
                    seed,
                    STALE_BACKLOG_DAYS,
                );
            case "ancient_fossil":
                return this.ancientFossilQuest(
                    template.criteria,
                    dna,
                    now,
                    seed,
                );
            case "deep_dive":
                return this.deepDiveQuest(template.criteria, dna, seed);
            case "off_the_map":
                return this.offTheMapQuest(template.criteria, dna, seed);
            case "continue_the_saga":
                return this.continueTheSagaQuest(template.criteria, dna, seed);
            case "time_machine":
                return this.timeMachineQuest(template.criteria, dna, seed);
            case "hidden_gem":
                return this.hiddenGemQuest(template.criteria, dna, seed);
            case "return_to_the_world":
                return this.returnToTheWorldQuest(template.criteria, dna, seed);
            case "the_colossus":
                return this.colossusQuest(template.criteria, dna, seed, 35);
            case "colossus_legend":
                return this.colossusQuest(template.criteria, dna, seed, 60);
            case "genre_marathon":
                return this.genreMarathonQuest(template.criteria, dna, seed);
            case "saga_trilogy":
                return this.sagaTrilogyQuest(template.criteria, dna, seed);
            case "short_caravan":
                return this.shortCaravanQuest(
                    template.criteria,
                    dna,
                    now,
                    seed,
                );
            case "backlog_taste_test":
                return this.backlogTasteTestQuest(
                    template.criteria,
                    dna,
                    seed,
                    template.targetCount,
                );
            case "captains_log":
                return this.captainsLogQuest(template.criteria, dna, seed);
            case "pack_cleanup":
                return this.packCleanupQuest(
                    template.criteria,
                    dna,
                    now,
                    seed,
                    template.targetCount,
                );
            default:
                return this.quest(template.criteria, [], null);
        }
    }

    private quest(
        criteria: GuildCriteria,
        candidateGames: GuildBoardCandidateGame[],
        meta: Record<string, unknown> | null,
    ): GuildProceduralQuest {
        return {
            eligible: true,
            criteria: { ...criteria },
            candidateGames,
            meta,
        };
    }

    private async loadLibraryDna(
        userId: string,
        now: Date,
    ): Promise<LibraryDna> {
        const monthKey = currentMonthKey(now);
        const monthStart = new Date(`${monthKey}-01T00:00:00-03:00`);
        const monthEnd = nextMonthResetAt(now);

        const [rows, genreRows, franchiseRows, monthFinishes, profileRows] =
            await Promise.all([
                this.dataSource.query(
                    `SELECT ce.gameId, ce.status, ce.plannedAt, ce.createdAt,
                            ce.startedAt, g.firstReleaseDate, g.aggregatedRatingCount,
                            (SELECT MAX(up.lastPlayedDate) FROM user_playtime up
                             WHERE up.profileUserId = ce.libraryUserId
                               AND up.gameId = ce.gameId) AS lastPlayedAt,
                            (SELECT GROUP_CONCAT(DISTINCT gg.gameGenreId)
                             FROM game_genres_game_genre gg
                             WHERE gg.gameId = ce.gameId) AS genreIds,
                            (SELECT GROUP_CONCAT(DISTINCT gf.gameFranchiseId)
                             FROM game_franchises_game_franchise gf
                             WHERE gf.gameId = ce.gameId) AS franchiseIds,
                            (SELECT GROUP_CONCAT(DISTINCT gt.gameThemeId)
                             FROM game_themes_game_theme gt
                             WHERE gt.gameId = ce.gameId) AS themeIds
                     FROM collection_entry ce
                     INNER JOIN game g ON g.id = ce.gameId
                     WHERE ce.libraryUserId = ?
                       AND ce.status IN (?, ?, ?, ?)
                       AND NOT EXISTS (
                           SELECT 1 FROM collection_entry_status_history h
                           WHERE h.libraryUserId = ce.libraryUserId
                             AND h.gameId = ce.gameId
                             AND h.toStatus = ?
                       )
                     ORDER BY COALESCE(ce.plannedAt, ce.createdAt) ASC, ce.gameId ASC
                     LIMIT ?`,
                    [
                        userId,
                        CollectionEntryStatus.PLANNED,
                        CollectionEntryStatus.PLAYING,
                        CollectionEntryStatus.ONGOING,
                        CollectionEntryStatus.DROPPED,
                        CollectionEntryStatus.FINISHED,
                        LIBRARY_SCAN_LIMIT,
                    ],
                ),
                this.dataSource.query(
                    `SELECT gg.gameGenreId AS id, COUNT(DISTINCT h.gameId) AS total
                     FROM collection_entry_status_history h
                     INNER JOIN game_genres_game_genre gg ON gg.gameId = h.gameId
                     WHERE h.libraryUserId = ? AND h.toStatus = ?
                     GROUP BY gg.gameGenreId`,
                    [userId, CollectionEntryStatus.FINISHED],
                ),
                this.dataSource.query(
                    `SELECT DISTINCT gf.gameFranchiseId AS id
                     FROM collection_entry_status_history h
                     INNER JOIN game_franchises_game_franchise gf
                         ON gf.gameId = h.gameId
                     WHERE h.libraryUserId = ? AND h.toStatus = ?`,
                    [userId, CollectionEntryStatus.FINISHED],
                ),
                this.dataSource.query(
                    `SELECT DISTINCT ce.gameId
                     FROM collection_entry ce
                     WHERE ce.libraryUserId = ? AND ce.status = ?
                       AND ce.finishedAt >= ? AND ce.finishedAt < ?`,
                    [
                        userId,
                        CollectionEntryStatus.FINISHED,
                        monthStart,
                        monthEnd,
                    ],
                ),
                this.dataSource.query(
                    "SELECT createdAt FROM profile WHERE userId = ?",
                    [userId],
                ),
            ]);

        const unfinished: LibraryGame[] = rows.map((row: any) => ({
            gameId: Number(row.gameId),
            status: row.status as CollectionEntryStatus,
            addedAt: new Date(row.plannedAt ?? row.createdAt),
            startedAt: row.startedAt ? new Date(row.startedAt) : null,
            lastPlayedAt: row.lastPlayedAt ? new Date(row.lastPlayedAt) : null,
            releasedAt: row.firstReleaseDate
                ? new Date(row.firstReleaseDate)
                : null,
            ratingCount:
                row.aggregatedRatingCount === null
                    ? null
                    : Number(row.aggregatedRatingCount),
            genreIds: parseIds(row.genreIds),
            franchiseIds: parseIds(row.franchiseIds),
            themeIds: parseIds(row.themeIds),
        }));

        return {
            userId,
            unfinished,
            playing: unfinished.filter(
                (game) =>
                    game.status === CollectionEntryStatus.PLAYING ||
                    game.status === CollectionEntryStatus.ONGOING,
            ),
            finishedGenreCounts: new Map(
                genreRows.map((row: any) => [
                    Number(row.id),
                    Number(row.total),
                ]),
            ),
            finishedFranchiseIds: new Set(
                franchiseRows.map((row: any) => Number(row.id)),
            ),
            finishedThisMonth: monthFinishes.map((row: any) =>
                Number(row.gameId),
            ),
            libraryAgeDays: profileRows[0]
                ? Math.floor(
                      (now.getTime() -
                          new Date(profileRows[0].createdAt).getTime()) /
                          DAY_MS,
                  )
                : 0,
        };
    }

    private staleCandidates(dna: LibraryDna, now: Date, days: number) {
        return dna.unfinished
            .filter(
                (game) =>
                    game.status === CollectionEntryStatus.PLANNED ||
                    game.status === CollectionEntryStatus.DROPPED,
            )
            .map((game) => ({
                game,
                untouchedDays: Math.floor(
                    (now.getTime() -
                        Math.max(
                            game.addedAt.getTime(),
                            game.lastPlayedAt?.getTime() ?? 0,
                        )) /
                        DAY_MS,
                ),
            }))
            .filter((candidate) => candidate.untouchedDays >= days);
    }

    private staleQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        now: Date,
        seed: Buffer | string,
        days: number,
    ): GuildProceduralQuest | null {
        const candidates = this.staleCandidates(dna, now, days);
        if (candidates.length === 0) return null;

        const ordered = seededOrder(
            seed,
            candidates,
            (candidate) => candidate.game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            criteria,
            ordered.map(({ game }) => ({
                gameId: game.gameId,
                sinceYear: game.addedAt.getUTCFullYear(),
            })),
            {
                staleDays: Math.max(
                    ...candidates.map((candidate) => candidate.untouchedDays),
                ),
            },
        );
    }

    /** ≥ 1,095 days, or the oldest untouched game of a 2+ year old library. */
    private ancientFossilQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        now: Date,
        seed: Buffer | string,
    ): GuildProceduralQuest | null {
        const ancient = this.staleQuest(
            criteria,
            dna,
            now,
            seed,
            ANCIENT_FOSSIL_DAYS,
        );
        if (ancient) return ancient;
        if (dna.libraryAgeDays < VETERAN_LIBRARY_DAYS) return null;
        return this.staleQuest(criteria, dna, now, seed, VETERAN_LIBRARY_DAYS);
    }

    private deepDiveQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): GuildProceduralQuest | null {
        if (dna.playing.length === 0) return null;
        const candidates = seededOrder(
            seed,
            dna.playing,
            (game) => game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            criteria,
            candidates.map((game) => ({ gameId: game.gameId })),
            null,
        );
    }

    /** Genre inversion: a genre the user barely finishes but still has in the backlog. */
    private async offTheMapQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): Promise<GuildProceduralQuest | null> {
        const byGenre = groupBy(
            dna.unfinished.flatMap((game) =>
                game.genreIds.map((genreId) => ({ game, genreId })),
            ),
            (item) => item.genreId,
        );
        if (byGenre.size === 0) return null;

        const maxFinished = Math.max(0, ...dna.finishedGenreCounts.values());
        const pool = [...byGenre.entries()].filter(([genreId, games]) => {
            if (games.length === 0) return false;
            // No finished games at all: every backlog genre is a new frontier.
            if (dna.finishedGenreCounts.size === 0) return true;
            return (dna.finishedGenreCounts.get(genreId) ?? 0) < maxFinished;
        });
        if (pool.length === 0) return null;

        const [genreId, games] = seededOrder(seed, pool, ([id]) => id).sort(
            (a, b) =>
                (dna.finishedGenreCounts.get(a[0]) ?? 0) -
                    (dna.finishedGenreCounts.get(b[0]) ?? 0) ||
                b[1].length - a[1].length,
        )[0];
        const candidates = seededOrder(
            seed,
            games,
            (item) => item.game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            { ...criteria, genreIds: [genreId] },
            candidates.map(({ game }) => ({ gameId: game.gameId })),
            { genreName: await this.resourceName("game_genre", genreId) },
        );
    }

    /** A franchise where the user finished at least one entry and has another unfinished. */
    private async continueTheSagaQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): Promise<GuildProceduralQuest | null> {
        const byFranchise = groupBy(
            dna.unfinished
                .filter(
                    (game) =>
                        game.status === CollectionEntryStatus.PLANNED ||
                        game.status === CollectionEntryStatus.PLAYING ||
                        game.status === CollectionEntryStatus.ONGOING,
                )
                .flatMap((game) =>
                    game.franchiseIds.map((franchiseId) => ({
                        game,
                        franchiseId,
                    })),
                ),
            (item) => item.franchiseId,
        );
        const pool = [...byFranchise.entries()].filter(
            ([franchiseId, games]) =>
                games.length > 0 && dna.finishedFranchiseIds.has(franchiseId),
        );
        if (pool.length === 0) return null;

        const [franchiseId, games] = seededOrder(seed, pool, ([id]) => id).sort(
            (a, b) => b[1].length - a[1].length,
        )[0];
        const candidates = seededOrder(
            seed,
            games,
            (item) => item.game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            { ...criteria, franchiseIds: [franchiseId] },
            candidates.map(({ game }) => ({ gameId: game.gameId })),
            {
                franchiseName: await this.resourceName(
                    "game_franchise",
                    franchiseId,
                ),
            },
        );
    }

    private timeMachineQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): GuildProceduralQuest | null {
        const byDecade = groupBy(
            dna.unfinished
                .filter((game) => game.releasedAt !== null)
                .map((game) => ({
                    game,
                    decade:
                        Math.floor(game.releasedAt!.getUTCFullYear() / 10) * 10,
                })),
            (item) => item.decade,
        );
        const pool = [...byDecade.entries()].filter(
            ([, games]) => games.length >= 2,
        );
        if (pool.length === 0) return null;

        const [decade, games] = seededOrder(
            seed,
            pool,
            ([value]) => value,
        ).sort((a, b) => b[1].length - a[1].length)[0];
        const candidates = seededOrder(
            seed,
            games,
            (item) => item.game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            {
                ...criteria,
                releaseYearMin: decade,
                releaseYearMax: decade + 9,
            },
            candidates.map(({ game }) => ({ gameId: game.gameId })),
            { decade: `${decade}s` },
        );
    }

    private hiddenGemQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): GuildProceduralQuest | null {
        const gems = dna.unfinished.filter(
            (game) =>
                game.genreIds.includes(INDIE_GENRE_ID) ||
                (game.ratingCount ?? 0) < LOW_POPULARITY_RATING_COUNT,
        );
        if (gems.length === 0) return null;

        const candidates = seededOrder(seed, gems, (game) => game.gameId).slice(
            0,
            CANDIDATE_LIMIT,
        );
        return this.quest(
            {
                ...criteria,
                gameIds: candidates.map((game) => game.gameId),
            },
            candidates.map((game) => ({ gameId: game.gameId })),
            null,
        );
    }

    /** Unfinished DLC, expansion, remake or remaster of a game the user finished. */
    private async returnToTheWorldQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): Promise<GuildProceduralQuest | null> {
        const rows: Array<{ gameId: number }> = await this.dataSource.query(
            `SELECT DISTINCT d.gameId_2 AS gameId FROM game_dlcs_game d
                 WHERE EXISTS (SELECT 1 FROM collection_entry_status_history h
                               WHERE h.libraryUserId = ? AND h.toStatus = ?
                                 AND h.gameId = d.gameId_1)
             UNION
             SELECT DISTINCT e.gameId_2 FROM game_expansions_game e
                 WHERE EXISTS (SELECT 1 FROM collection_entry_status_history h
                               WHERE h.libraryUserId = ? AND h.toStatus = ?
                                 AND h.gameId = e.gameId_1)
             UNION
             SELECT DISTINCT r.gameId_2 FROM game_remakes_game r
                 WHERE EXISTS (SELECT 1 FROM collection_entry_status_history h
                               WHERE h.libraryUserId = ? AND h.toStatus = ?
                                 AND h.gameId = r.gameId_1)
             UNION
             SELECT DISTINCT m.gameId_2 FROM game_remasters_game m
                 WHERE EXISTS (SELECT 1 FROM collection_entry_status_history h
                               WHERE h.libraryUserId = ? AND h.toStatus = ?
                                 AND h.gameId = m.gameId_1)`,
            [
                dna.userId,
                CollectionEntryStatus.FINISHED,
                dna.userId,
                CollectionEntryStatus.FINISHED,
                dna.userId,
                CollectionEntryStatus.FINISHED,
                dna.userId,
                CollectionEntryStatus.FINISHED,
            ],
        );
        const unfinishedIds = new Set(
            dna.unfinished.map((game) => game.gameId),
        );
        const related = rows
            .map((row) => Number(row.gameId))
            .filter((gameId) => unfinishedIds.has(gameId));
        if (related.length === 0) return null;

        const candidates = seededOrder(seed, related, (gameId) => gameId).slice(
            0,
            CANDIDATE_LIMIT,
        );
        return this.quest(
            { ...criteria, gameIds: candidates },
            candidates.map((gameId) => ({ gameId })),
            null,
        );
    }

    /** Cached TTB at or above the template's minimum (35h or 60h). */
    private async colossusQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
        minHours: number,
    ): Promise<GuildProceduralQuest | null> {
        const gameIds = dna.unfinished.map((game) => game.gameId);
        if (gameIds.length === 0) return null;
        const rows: Array<{
            gameId: number;
            normallySeconds: number | null;
            hastilySeconds: number | null;
        }> = await this.dataSource.query(
            `SELECT gameId, normallySeconds, hastilySeconds
             FROM game_time_to_beat
             WHERE gameId IN (${gameIds.map(() => "?").join(",")})`,
            gameIds,
        );
        const secondsByGameId = new Map(
            rows.map((row) => [
                Number(row.gameId),
                row.normallySeconds ?? row.hastilySeconds,
            ]),
        );
        const minSeconds = minHours * 60 * 60;
        const candidates = dna.unfinished
            .map((game) => ({
                game,
                seconds: secondsByGameId.get(game.gameId) ?? null,
            }))
            .filter(
                (
                    item,
                ): item is {
                    game: LibraryGame;
                    seconds: number;
                } =>
                    item.seconds !== null &&
                    item.seconds > 0 &&
                    item.seconds >= minSeconds,
            );
        if (candidates.length === 0) return null;

        const ordered = seededOrder(
            seed,
            candidates,
            (candidate) => candidate.game.gameId,
        )
            .sort((a, b) => b.seconds - a.seconds)
            .slice(0, CANDIDATE_LIMIT);
        return this.quest(
            { ...criteria, minTimeToBeatHours: minHours },
            ordered.map(({ game, seconds }) => ({
                gameId: game.gameId,
                estimatedHours: Math.max(1, Math.round(seconds / 3_600)),
            })),
            null,
        );
    }

    private async genreMarathonQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): Promise<GuildProceduralQuest | null> {
        const byGenre = groupBy(
            dna.unfinished.flatMap((game) =>
                game.genreIds.map((genreId) => ({ game, genreId })),
            ),
            (item) => item.genreId,
        );
        const pool = [...byGenre.entries()].filter(
            ([, games]) => games.length >= 3,
        );
        if (pool.length === 0) return null;

        const [genreId, games] = seededOrder(seed, pool, ([id]) => id).sort(
            (a, b) => b[1].length - a[1].length,
        )[0];
        const candidates = seededOrder(
            seed,
            games,
            (item) => item.game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            { ...criteria, genreIds: [genreId] },
            candidates.map(({ game }) => ({ gameId: game.gameId })),
            { genreName: await this.resourceName("game_genre", genreId) },
        );
    }

    private async sagaTrilogyQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): Promise<GuildProceduralQuest | null> {
        const byFranchise = groupBy(
            dna.unfinished.flatMap((game) =>
                game.franchiseIds.map((franchiseId) => ({
                    game,
                    franchiseId,
                })),
            ),
            (item) => item.franchiseId,
        );
        const franchisePool = [...byFranchise.entries()].filter(
            ([, games]) => games.length >= 3,
        );
        if (franchisePool.length > 0) {
            const [franchiseId, games] = seededOrder(
                seed,
                franchisePool,
                ([id]) => id,
            ).sort((a, b) => b[1].length - a[1].length)[0];
            const candidates = seededOrder(
                seed,
                games,
                (item) => item.game.gameId,
            ).slice(0, CANDIDATE_LIMIT);
            return this.quest(
                { ...criteria, franchiseIds: [franchiseId] },
                candidates.map(({ game }) => ({ gameId: game.gameId })),
                {
                    franchiseName: await this.resourceName(
                        "game_franchise",
                        franchiseId,
                    ),
                },
            );
        }

        const byTheme = groupBy(
            dna.unfinished.flatMap((game) =>
                game.themeIds.map((themeId) => ({ game, themeId })),
            ),
            (item) => item.themeId,
        );
        const themePool = [...byTheme.entries()].filter(
            ([, games]) => games.length >= 3,
        );
        if (themePool.length === 0) return null;

        const [themeId, games] = seededOrder(
            seed,
            themePool,
            ([id]) => id,
        ).sort((a, b) => b[1].length - a[1].length)[0];
        const candidates = seededOrder(
            seed,
            games,
            (item) => item.game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            { ...criteria, themeIds: [themeId] },
            candidates.map(({ game }) => ({ gameId: game.gameId })),
            { themeName: await this.resourceName("game_theme", themeId) },
        );
    }

    private async shortCaravanQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        now: Date,
        seed: Buffer | string,
    ): Promise<GuildProceduralQuest | null> {
        const maxSeconds = (criteria.maxTimeToBeatHours ?? 8) * 60 * 60;
        const recent = dna.unfinished.slice(-SHORT_GAME_SCAN_LIMIT);
        if (recent.length === 0) return null;

        const timesToBeat = await this.guildTimeToBeatService.getForGameIds(
            recent.map((game) => game.gameId),
            now,
        );
        const candidates = recent
            .map((game) => ({
                game,
                seconds: getEffectiveTtbSeconds(timesToBeat.get(game.gameId)),
            }))
            .filter(
                (
                    item,
                ): item is {
                    game: LibraryGame;
                    seconds: number;
                } =>
                    item.seconds !== null &&
                    item.seconds > 0 &&
                    item.seconds <= maxSeconds,
            );
        if (candidates.length === 0) return null;

        const ordered = seededOrder(
            seed,
            candidates,
            (candidate) => candidate.game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            criteria,
            ordered.map(({ game, seconds }) => ({
                gameId: game.gameId,
                estimatedHours: Math.max(1, Math.round(seconds / 3_600)),
            })),
            null,
        );
    }

    private backlogTasteTestQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
        targetCount: number,
    ): GuildProceduralQuest | null {
        const planned = dna.unfinished.filter(
            (game) => game.status === CollectionEntryStatus.PLANNED,
        );
        if (planned.length < targetCount) return null;

        const candidates = seededOrder(
            seed,
            planned,
            (game) => game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            criteria,
            candidates.map((game) => ({ gameId: game.gameId })),
            null,
        );
    }

    private captainsLogQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        seed: Buffer | string,
    ): GuildProceduralQuest | null {
        if (dna.finishedThisMonth.length === 0) return null;

        const candidates = seededOrder(
            seed,
            dna.finishedThisMonth,
            (gameId) => gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            criteria,
            candidates.map((gameId) => ({ gameId })),
            null,
        );
    }

    private packCleanupQuest(
        criteria: GuildCriteria,
        dna: LibraryDna,
        now: Date,
        seed: Buffer | string,
        targetCount: number,
    ): GuildProceduralQuest | null {
        const cutoff = now.getTime() - BACKLOG_TRIAGE_DAYS * DAY_MS;
        const triageable = dna.unfinished.filter(
            (game) =>
                game.status === CollectionEntryStatus.PLANNED &&
                game.addedAt.getTime() <= cutoff,
        );
        if (triageable.length < targetCount) return null;

        const candidates = seededOrder(
            seed,
            triageable,
            (game) => game.gameId,
        ).slice(0, CANDIDATE_LIMIT);
        return this.quest(
            criteria,
            candidates.map((game) => ({ gameId: game.gameId })),
            null,
        );
    }

    private async resourceName(
        table: "game_genre" | "game_franchise" | "game_theme",
        id: number,
    ): Promise<string | null> {
        const rows: Array<{ name: string | null }> =
            await this.dataSource.query(
                `SELECT name FROM ${table} WHERE id = ?`,
                [id],
            );
        return rows[0]?.name ?? null;
    }
}
