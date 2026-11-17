import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import { DataSource, EntityManager, In } from "typeorm";
import { AuthService } from "../auth/auth.service";
import { BillingService } from "../billing/billing.service";
import { Profile } from "../profile/entities/profile.entity";
import { ProfileSupporterPreferences } from "../profile/entities/profile-supporter-preferences.entity";
import {
    addDays,
    DAILY_MAX_ATTEMPTS,
    DailyMode,
    dailyNextResetAt,
    DailyStatus,
    dailyToday,
    mondayOf,
} from "./daily.constants";
import {
    buildRankingTotals,
    COMPLETION_BONUS,
    computeStreaks,
    DailyRankingPeriod,
    DailyRankingScope,
    DailyRankingTotals,
    RANKING_ALL_START,
    RankedDailyResult,
} from "./daily-ranking.utils";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import {
    DailyRankingResponseDto,
    DailyRankingRowDto,
    DailyRankingSummaryDto,
    DailyWeeklyDto,
    DailyWeeklyRankingResponseDto,
} from "./dto/daily-response.dto";
import { buildPaginationResponse } from "../utils/pagination/buildPaginationResponse";

/** Position 100 is the last one the viewer summary reports a gap to. */
const TOP_POSITION = 100;

/** One boot rebuild at a time across replicas; the lock lives on a pinned connection. */
const REBUILD_LOCK = "daily_ranking_rebuild";
const SNAPSHOT_LOCK = "daily_ranking_snapshot";
const SNAPSHOT_MARKER_PREFIX = "daily:ranking:snapshot:";
const SNAPSHOT_MARKER_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const REBUILD_BATCH = 500;
const SNAPSHOT_CHUNK = 1000;

const MODES = Object.values(DailyMode);
const RANKING_ORDER =
    "points DESC, winAttempts ASC, lastFinishedAt ASC, userId ASC";
const RANKING_COLUMNS = `userId, points, wins, played, winAttempts, lastFinishedAt,
    coverPoints, artworkPoints, keywordsPoints, specsPoints`;
const RANKING_COLUMNS_JOINED = `e.userId, e.points, e.wins, e.played,
    e.winAttempts, e.lastFinishedAt, e.coverPoints, e.artworkPoints,
    e.keywordsPoints, e.specsPoints`;
const RANKING_ORDER_JOINED =
    "e.points DESC, e.winAttempts ASC, e.lastFinishedAt ASC, e.userId ASC";

type RankingMode = DailyMode | "overall";

const periodStart = (period: DailyRankingPeriod, end: string) => {
    if (period === "today") return end;
    if (period === "week") return mondayOf(end);
    if (period === "month") return `${end.slice(0, 8)}01`;
    return RANKING_ALL_START;
};

/** Last day of the month `end` belongs to. */
const monthEnd = (end: string) => {
    const [year, month] = end.split("-").map(Number);
    const last = new Date(Date.UTC(year, month, 0));
    return `${end.slice(0, 8)}${String(last.getUTCDate()).padStart(2, "0")}`;
};

const periodEnd = (period: DailyRankingPeriod, today: string) => {
    if (period === "today") return today;
    if (period === "week") return addDays(mondayOf(today), 6);
    if (period === "month") return monthEnd(today);
    return null;
};

/** `DATE` columns come back as strings, but a custom driver may hand back Date. */
const dayOf = (value: string | Date) =>
    typeof value === "string"
        ? value.slice(0, 10)
        : value.toISOString().slice(0, 10);

const round = (value: number) => Math.round(value * 10) / 10;

const placeholders = (values: unknown[]) => values.map(() => "?").join(",");

interface RankingEntryRow {
    userId: string;
    points: string | number;
    wins: string | number;
    played: string | number;
    winAttempts: string | number;
    lastFinishedAt: Date | string;
    coverPoints: string | number;
    artworkPoints: string | number;
    keywordsPoints: string | number;
    specsPoints: string | number;
    [modePoints: string]: unknown;
}

interface RankingPartition {
    period: DailyRankingPeriod;
    periodStart: string;
    mode: RankingMode;
}

interface RankedItem {
    entry: RankingEntryRow;
    position: number;
}

interface OrderingEntry {
    userId: string;
    points: string | number;
    winAttempts: string | number;
    lastFinishedAt: Date | string;
}

@Injectable()
export class DailyRankingService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly authService: AuthService,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
        private readonly billingService: BillingService,
    ) {}

    /**
     * Recomputes one player's entries from their counted results, with absolute values.
     * The profile row lock serializes the player's finishes so a concurrent one is never lost.
     */
    async recompute(
        userId: string,
        today: string,
        manager: EntityManager = this.dataSource.manager,
    ): Promise<void> {
        await manager.query(
            "SELECT userId FROM profile WHERE userId = ? FOR UPDATE",
            [userId],
        );
        const results = await this.rankedResults([userId], manager);
        await this.upsertTotals(
            results.flatMap((result) =>
                buildRankingTotals(result.results, today).map((totals) => ({
                    ...totals,
                    userId: result.userId,
                })),
            ),
            manager,
        );
    }

    /** Rewrites every player's entries in batches; the boot repair path. */
    async rebuild(today: string): Promise<number> {
        const users: { userId: string }[] = await this.dataSource.query(
            `SELECT DISTINCT r.userId AS userId
             FROM daily_result r
             JOIN daily_puzzle p ON p.id = r.puzzleId
             WHERE p.kind = 'daily' AND r.ranked = 1`,
        );
        let rebuilt = 0;
        for (let index = 0; index < users.length; index += REBUILD_BATCH) {
            const ids = users
                .slice(index, index + REBUILD_BATCH)
                .map((user) => user.userId);
            const results = await this.rankedResults(ids);
            await this.upsertTotals(
                results.flatMap((result) =>
                    buildRankingTotals(result.results, today).map((totals) => ({
                        ...totals,
                        userId: result.userId,
                    })),
                ),
            );
            rebuilt += ids.length;
        }
        return rebuilt;
    }

    /**
     * Fills the previous positions used by the ranking read. Reads the values without
     * today's results and never takes a lock a finish waits on, so it can run at midnight.
     */
    async snapshot(today: string): Promise<number> {
        const periods: { period: DailyRankingPeriod; start: string }[] = [
            { period: "week", start: mondayOf(today) },
            { period: "month", start: `${today.slice(0, 8)}01` },
            { period: "all", start: RANKING_ALL_START },
        ];
        const modes: RankingMode[] = ["overall", ...MODES];
        let written = 0;
        for (const { period, start } of periods) {
            for (const mode of modes) {
                const rows: { userId: string }[] = await this.dataSource.query(
                    `SELECT userId FROM (
                         SELECT userId,
                                IF(asOf = ?, prevPoints, points) AS points,
                                IF(asOf = ?, prevWinAttempts, winAttempts) AS winAttempts,
                                IF(asOf = ?, prevLastFinishedAt, lastFinishedAt) AS lastFinishedAt,
                                IF(asOf = ?, prevPlayed, played) AS played
                         FROM daily_ranking_entry
                         WHERE period = ? AND periodStart = ? AND mode = ?
                     ) previous
                     WHERE played > 0
                     ORDER BY points DESC, winAttempts ASC, lastFinishedAt ASC, userId ASC`,
                    [today, today, today, today, period, start, mode],
                );
                const positions = rows.map((row, index) => [
                    period,
                    start,
                    mode,
                    today,
                    row.userId,
                    index + 1,
                ]);
                for (
                    let index = 0;
                    index < positions.length;
                    index += SNAPSHOT_CHUNK
                )
                    await this.dataSource.query(
                        `INSERT INTO daily_ranking_snapshot
                             (period, periodStart, mode, date, userId, position)
                         VALUES ?
                         ON DUPLICATE KEY UPDATE position = VALUES(position)`,
                        [positions.slice(index, index + SNAPSHOT_CHUNK)],
                    );
                written += rows.length;
            }
        }
        // The marker tells a boot that today's snapshot is already complete; it expires
        // before the same key could ever be needed again.
        await this.cache
            .set(this.snapshotMarker(today), true, SNAPSHOT_MARKER_TTL_MS)
            .catch(() => undefined);
        return written;
    }

    /** Boot rebuild: only while the table has no `all` entry and ranked results exist. */
    async rebuildIfEmpty(today: string): Promise<void> {
        if (!(await this.needsRebuild())) return;
        await this.withLock(REBUILD_LOCK, async () => {
            if (await this.needsRebuild()) await this.rebuild(today);
        });
    }

    /** Boot snapshot: only when today's marker is missing (a midnight rerun is harmless). */
    async snapshotIfNeeded(today: string): Promise<void> {
        if (await this.hasSnapshot(today)) return;
        await this.withLock(SNAPSHOT_LOCK, async () => {
            if (!(await this.hasSnapshot(today))) await this.snapshot(today);
        });
    }

    /** Deletes partitions of past periods and snapshots older than today. */
    async cleanup(today: string): Promise<void> {
        await this.dataSource.query(
            `DELETE FROM daily_ranking_entry
             WHERE (period = 'today' AND periodStart < ?)
                OR (period = 'week' AND periodStart < ?)
                OR (period = 'month' AND periodStart < ?)`,
            [today, mondayOf(today), `${today.slice(0, 8)}01`],
        );
        await this.dataSource.query(
            "DELETE FROM daily_ranking_snapshot WHERE date < ?",
            [today],
        );
    }

    /** Runs `task` under a MySQL named lock held by one pinned connection. */
    private async withLock(
        name: string,
        task: () => Promise<void>,
    ): Promise<void> {
        const runner = this.dataSource.createQueryRunner();
        let acquired = false;
        try {
            await runner.connect();
            const [lock] = await runner.query(
                "SELECT GET_LOCK(?, 0) AS acquired",
                [name],
            );
            acquired = Number(lock?.acquired) === 1;
            if (acquired) await task();
        } finally {
            try {
                if (acquired)
                    await runner.query("SELECT RELEASE_LOCK(?)", [name]);
            } finally {
                await runner.release();
            }
        }
    }

    private async needsRebuild() {
        const [row] = await this.dataSource.query(
            `SELECT EXISTS(SELECT 1 FROM daily_ranking_entry WHERE period = 'all') AS hasEntries,
                    EXISTS(SELECT 1 FROM daily_result r
                           JOIN daily_puzzle p ON p.id = r.puzzleId
                           WHERE p.kind = 'daily' AND r.ranked = 1) AS hasResults`,
        );
        return Number(row?.hasResults) === 1 && Number(row?.hasEntries) === 0;
    }

    private async hasSnapshot(today: string) {
        return (
            (await this.cache
                .get(this.snapshotMarker(today))
                .catch(() => undefined)) != null
        );
    }

    private snapshotMarker(today: string) {
        return `${SNAPSHOT_MARKER_PREFIX}${today}`;
    }

    /** Ranked daily results per player; weekly and imported rows never reach an entry. */
    private async rankedResults(
        ids: string[],
        manager: EntityManager = this.dataSource.manager,
    ): Promise<{ userId: string; results: RankedDailyResult[] }[]> {
        if (!ids.length) return [];
        const rows: {
            userId: string;
            mode: DailyMode;
            date: string | Date;
            points: string | number;
            status: DailyStatus;
            attempts: string | number;
            finishedAt: Date | string;
        }[] = await manager.query(
            `SELECT r.userId AS userId, p.mode AS mode, p.date AS date,
                    r.points AS points, r.status AS status, r.attempts AS attempts,
                    r.finishedAt AS finishedAt
             FROM daily_result r
             JOIN daily_puzzle p ON p.id = r.puzzleId
             WHERE p.kind = 'daily' AND r.ranked = 1
                   AND r.finishedAt IS NOT NULL
                   AND r.userId IN (${placeholders(ids)})`,
            ids,
        );
        const byId = new Map<string, RankedDailyResult[]>();
        for (const row of rows) {
            const results = byId.get(row.userId) ?? [];
            results.push({
                mode: row.mode,
                date: dayOf(row.date),
                points: Number(row.points),
                status: row.status,
                attempts: Number(row.attempts),
                finishedAt: new Date(row.finishedAt),
            });
            byId.set(row.userId, results);
        }
        return ids.map((userId) => ({
            userId,
            results: byId.get(userId) ?? [],
        }));
    }

    private async upsertTotals(
        totals: (DailyRankingTotals & { userId: string })[],
        manager: EntityManager = this.dataSource.manager,
    ): Promise<void> {
        if (!totals.length) return;
        await manager.query(
            `INSERT INTO daily_ranking_entry
                 (period, periodStart, mode, userId, points, coverPoints, artworkPoints,
                  keywordsPoints, specsPoints, wins, played, winAttempts, lastFinishedAt,
                  prevPoints, prevPlayed, prevWinAttempts, prevLastFinishedAt, asOf,
                  streak, streakEnd, bestStreak)
             VALUES ?
             ON DUPLICATE KEY UPDATE
                 points = VALUES(points), coverPoints = VALUES(coverPoints),
                 artworkPoints = VALUES(artworkPoints), keywordsPoints = VALUES(keywordsPoints),
                 specsPoints = VALUES(specsPoints), wins = VALUES(wins),
                 played = VALUES(played), winAttempts = VALUES(winAttempts),
                 lastFinishedAt = VALUES(lastFinishedAt), prevPoints = VALUES(prevPoints),
                 prevPlayed = VALUES(prevPlayed), prevWinAttempts = VALUES(prevWinAttempts),
                 prevLastFinishedAt = VALUES(prevLastFinishedAt), asOf = VALUES(asOf),
                 streak = VALUES(streak), streakEnd = VALUES(streakEnd),
                 bestStreak = VALUES(bestStreak)`,
            [
                totals.map((row) => [
                    row.period,
                    row.periodStart,
                    row.mode,
                    row.userId,
                    row.points,
                    row.coverPoints,
                    row.artworkPoints,
                    row.keywordsPoints,
                    row.specsPoints,
                    row.wins,
                    row.played,
                    row.winAttempts,
                    row.lastFinishedAt,
                    row.prevPoints,
                    row.prevPlayed,
                    row.prevWinAttempts,
                    row.prevLastFinishedAt,
                    row.asOf,
                    row.streak,
                    row.streakEnd,
                    row.bestStreak,
                ]),
            ],
        );
    }

    /** One page of the ranking plus the viewer's own row, read from the entries. */
    async read(
        period: DailyRankingPeriod,
        mode: DailyMode | undefined,
        scope: DailyRankingScope,
        offset: number,
        limit: number,
        viewerId?: string,
        today = dailyToday(),
    ): Promise<DailyRankingResponseDto> {
        if (scope === "following" && !viewerId)
            throw new UnauthorizedException();
        const partition: RankingPartition = {
            period,
            periodStart: periodStart(period, today),
            mode: mode ?? "overall",
        };
        const [locked, followed] = await Promise.all([
            this.authService.getLockedUserIds(),
            scope === "following" ? this.followedIds(viewerId!) : null,
        ]);
        const scopeIds = followed ? [viewerId!, ...followed] : null;
        const filter = this.entryFilter(partition, locked, scopeIds);

        const [countRows, rows, viewerEntry, hasSnapshot] = await Promise.all([
            scopeIds
                ? Promise.resolve(null)
                : this.dataSource.query<{ total: string | number }[]>(
                      `SELECT COUNT(*) AS total FROM daily_ranking_entry WHERE ${filter.sql}`,
                      filter.params,
                  ),
            scopeIds
                ? this.dataSource.query<RankingEntryRow[]>(
                      `SELECT ${RANKING_COLUMNS} FROM daily_ranking_entry
                       WHERE ${filter.sql} ORDER BY ${RANKING_ORDER}`,
                      filter.params,
                  )
                : this.dataSource.query<RankingEntryRow[]>(
                      // Skip the offset on the order index alone, then read the page rows
                      // by primary key: a deep page never reads the rows it skips.
                      `SELECT ${RANKING_COLUMNS_JOINED}
                       FROM (SELECT period, periodStart, mode, userId
                             FROM daily_ranking_entry
                             WHERE ${filter.sql}
                             ORDER BY ${RANKING_ORDER}
                             LIMIT ? OFFSET ?) page
                       JOIN daily_ranking_entry e
                         ON e.period = page.period
                        AND e.periodStart = page.periodStart
                        AND e.mode = page.mode
                        AND e.userId = page.userId
                       ORDER BY ${RANKING_ORDER_JOINED}`,
                      [...filter.params, limit, offset],
                  ),
            viewerId ? this.findEntry(partition, viewerId) : null,
            period === "today" ? false : this.hasSnapshot(today),
        ]);

        const scopedRows = scopeIds ? rows : null;
        const visibleRows = scopedRows
            ? scopedRows.slice(offset, offset + limit)
            : rows;
        const visible: RankedItem[] = visibleRows.map((entry, index) => ({
            entry,
            position: offset + index + 1,
        }));
        const totalPlayers = scopedRows
            ? scopedRows.length
            : Number(countRows?.[0]?.total ?? 0);

        const viewerAllowed =
            viewerId && viewerEntry && !locked.includes(viewerId)
                ? viewerEntry
                : null;
        const viewerPosition = viewerAllowed
            ? scopedRows
                ? scopedRows.findIndex(
                      (row) => row.userId === viewerAllowed.userId,
                  ) + 1
                : 1 +
                  (await this.orderedBefore(
                      partition,
                      locked,
                      null,
                      viewerAllowed,
                      viewerId,
                  ))
            : 0;
        const viewerItem: RankedItem | null =
            viewerAllowed && viewerPosition > 0
                ? { entry: viewerAllowed, position: viewerPosition }
                : null;

        const ids = [
            ...visible.map((item) => item.entry.userId),
            ...(viewerItem ? [viewerItem.entry.userId] : []),
        ];
        const [previous, top100] = await Promise.all([
            hasSnapshot
                ? this.previousPositions(
                      partition,
                      today,
                      locked,
                      scopeIds,
                      ids,
                  )
                : null,
            viewerItem && viewerItem.position > TOP_POSITION
                ? scopedRows
                    ? scopedRows[TOP_POSITION - 1]
                    : this.entryAtPosition(partition, locked, TOP_POSITION - 1)
                : null,
        ]);

        const items =
            viewerItem &&
            !visible.some(
                (item) => item.entry.userId === viewerItem.entry.userId,
            )
                ? [...visible, viewerItem]
                : visible;
        const hydrated = await this.hydrate(items, mode, today, previous);
        const byId = new Map(hydrated.map((row) => [row.userId, row]));
        const pointsToTop100 = top100
            ? Math.max(
                  0,
                  Number(top100.points) - Number(viewerItem!.entry.points),
              ) / 10
            : null;
        const endDate = periodEnd(period, today);
        const { pagination } = buildPaginationResponse<DailyRankingRowDto>(
            [[], totalPlayers],
            { offset, limit },
        );
        return {
            period,
            mode: mode ?? null,
            scope,
            endsAt: endDate ? dailyNextResetAt(endDate) : null,
            totalPlayers,
            viewer: viewerItem
                ? (byId.get(viewerItem.entry.userId) ?? null)
                : null,
            pointsToTop100,
            data: visible.map((item) => byId.get(item.entry.userId)!),
            pagination,
        };
    }

    /** This week's challenge with the viewer's progress, or null without one. */
    async weeklyEntry(userId?: string): Promise<DailyWeeklyDto | null> {
        const puzzle = await this.weeklyPuzzle();
        if (!puzzle) return null;
        const result = userId
            ? await this.dataSource
                  .getRepository(DailyResult)
                  .findOneBy({ userId, puzzleId: puzzle.id })
            : null;
        return {
            id: puzzle.id,
            number: puzzle.number,
            mode: puzzle.mode,
            maxAttempts: DAILY_MAX_ATTEMPTS[puzzle.mode],
            endsAt: dailyNextResetAt(addDays(puzzle.date, 6)),
            ...(result && {
                result: { status: result.status, attempts: result.attempts },
            }),
        };
    }

    /** The current challenge ranked against the viewer and the players they follow. */
    async weeklyRanking(
        viewerId: string,
    ): Promise<DailyWeeklyRankingResponseDto> {
        const weekly = await this.weeklyEntry();
        if (!weekly) return { weekly: null, data: [] };
        const ids = [viewerId, ...(await this.followedIds(viewerId))];
        const rows: {
            userId: string;
            status: DailyStatus;
            attempts: string | number;
            finishedAt: Date | string | null;
        }[] = await this.dataSource.query(
            `SELECT r.userId AS userId, r.status AS status,
                    r.attempts AS attempts, r.finishedAt AS finishedAt
             FROM daily_result r
             JOIN daily_puzzle p ON p.id = r.puzzleId
             WHERE p.kind = 'weekly' AND p.id = ? AND r.ranked = 1
                   AND r.userId IN (${placeholders(ids)})
             ORDER BY (r.status = ?) DESC, r.attempts ASC, r.finishedAt ASC`,
            [weekly.id, ...ids, DailyStatus.WON],
        );
        const profiles = rows.length
            ? await this.dataSource.getRepository(Profile).find({
                  where: { userId: In(rows.map((row) => row.userId)) },
                  relations: { avatar: true },
              })
            : [];
        const byId = new Map(
            profiles.map((profile) => [profile.userId, profile]),
        );
        const badges = await this.supporterBadgeIds(
            rows.map((row) => row.userId),
        );
        return {
            weekly,
            data: rows.map((row) => ({
                userId: row.userId,
                username: byId.get(row.userId)?.username ?? "",
                avatar: byId.get(row.userId)?.avatar ?? null,
                supporterBadge: badges.has(row.userId),
                status: row.status,
                attempts: Number(row.attempts),
                finishedAt: row.finishedAt ? new Date(row.finishedAt) : null,
            })),
        };
    }

    /**
     * Points and weekly positions for the result that just finished (or was reopened).
     * Counted state comes from the stored row, so a reopen never counts again.
     */
    async summaryAfterPlay(
        userId: string,
        result: Pick<DailyResult, "puzzleId" | "status" | "ranked" | "points">,
        date: string,
    ): Promise<DailyRankingSummaryDto> {
        const today = dailyToday();
        const counted = !!result.ranked;
        const earned = counted ? result.points : 0;
        // The bonus belongs to the result's puzzle day, even when a later request reopens it.
        const bonus = counted
            ? await this.bonusForResult(userId, date, result.puzzleId)
            : 0;
        const partition: RankingPartition = {
            period: "week",
            periodStart: mondayOf(today),
            mode: "overall",
        };
        const [locked, entry] = await Promise.all([
            this.authService.getLockedUserIds(),
            this.findEntry(partition, userId),
        ]);
        if (!entry)
            return {
                counted,
                pointsEarned: earned / 10,
                bonusEarned: bonus / 10,
                weekPoints: 0,
                weekPosition: null,
                previousWeekPosition: null,
                pointsToTop100: null,
            };

        const weekPosition =
            1 +
            (await this.orderedBefore(partition, locked, null, entry, userId));
        // Without other counted results this week there is no "before" position, and a result
        // from a past week is not part of this week's entry to subtract.
        const inWeek = date >= partition.periodStart && date <= today;
        const previousEntry =
            !counted || !inWeek
                ? entry
                : Number(entry.played) > 1
                  ? {
                        ...entry,
                        points: Number(entry.points) - earned - bonus,
                    }
                  : null;
        const previousWeekPosition = previousEntry
            ? 1 +
              (await this.orderedBefore(
                  partition,
                  locked,
                  null,
                  previousEntry,
                  userId,
              ))
            : null;
        const top100 =
            weekPosition > TOP_POSITION
                ? await this.entryAtPosition(
                      partition,
                      locked,
                      TOP_POSITION - 1,
                  )
                : null;
        return {
            counted,
            pointsEarned: earned / 10,
            bonusEarned: bonus / 10,
            weekPoints: Number(entry.points) / 10,
            weekPosition,
            previousWeekPosition,
            pointsToTop100: top100
                ? Math.max(0, Number(top100.points) - Number(entry.points)) / 10
                : null,
        };
    }

    private entryFilter(
        partition: RankingPartition,
        locked: string[],
        ids: string[] | null,
    ): { sql: string; params: unknown[] } {
        let sql = "period = ? AND periodStart = ? AND mode = ?";
        const params: unknown[] = [
            partition.period,
            partition.periodStart,
            partition.mode,
        ];
        if (locked.length) {
            sql += ` AND userId NOT IN (${placeholders(locked)})`;
            params.push(...locked);
        }
        if (ids) {
            sql += ` AND userId IN (${placeholders(ids)})`;
            params.push(...ids);
        }
        return { sql, params };
    }

    private async findEntry(
        partition: RankingPartition,
        userId: string,
    ): Promise<RankingEntryRow | null> {
        const [row] = await this.dataSource.query<RankingEntryRow[]>(
            `SELECT ${RANKING_COLUMNS} FROM daily_ranking_entry
             WHERE period = ? AND periodStart = ? AND mode = ? AND userId = ?`,
            [partition.period, partition.periodStart, partition.mode, userId],
        );
        return row ?? null;
    }

    /** Index-range count of rows that sort before `entry`. */
    private async orderedBefore(
        partition: RankingPartition,
        locked: string[],
        ids: string[] | null,
        entry: OrderingEntry,
        excludeUserId?: string,
    ): Promise<number> {
        const filter = this.entryFilter(partition, locked, ids);
        let sql = `SELECT COUNT(*) AS rowsBefore FROM daily_ranking_entry WHERE ${filter.sql}`;
        const params = [...filter.params];
        if (excludeUserId) {
            sql += " AND userId <> ?";
            params.push(excludeUserId);
        }
        sql += ` AND (points > ? OR (points = ? AND (winAttempts < ? OR (winAttempts = ? AND (lastFinishedAt < ? OR (lastFinishedAt = ? AND userId < ?))))))`;
        const finishedAt = new Date(entry.lastFinishedAt);
        params.push(
            Number(entry.points),
            Number(entry.points),
            Number(entry.winAttempts),
            Number(entry.winAttempts),
            finishedAt,
            finishedAt,
            entry.userId,
        );
        const [row] = await this.dataSource.query<
            { rowsBefore: string | number }[]
        >(sql, params);
        return Number(row?.rowsBefore ?? 0);
    }

    /** The row at a zero-based offset in the partition, along the order index. */
    private async entryAtPosition(
        partition: RankingPartition,
        locked: string[],
        index: number,
    ): Promise<RankingEntryRow | null> {
        const filter = this.entryFilter(partition, locked, null);
        const [row] = await this.dataSource.query<RankingEntryRow[]>(
            `SELECT ${RANKING_COLUMNS} FROM daily_ranking_entry
             WHERE ${filter.sql} ORDER BY ${RANKING_ORDER}
             LIMIT 1 OFFSET ?`,
            [...filter.params, index],
        );
        return row ?? null;
    }

    /**
     * Snapshot positions adjusted for bans. For `following`, the set is renumbered without
     * locked players; for `all`, each position drops the locked players below it.
     */
    private async previousPositions(
        partition: RankingPartition,
        today: string,
        locked: string[],
        following: string[] | null,
        ids: string[],
    ): Promise<Map<string, number>> {
        const filter = `period = ? AND periodStart = ? AND mode = ? AND date = ?`;
        const params = [
            partition.period,
            partition.periodStart,
            partition.mode,
            today,
        ];
        if (following) {
            const rows = following.length
                ? await this.dataSource.query<
                      { userId: string; position: string | number }[]
                  >(
                      `SELECT userId, position FROM daily_ranking_snapshot
                       WHERE ${filter} AND userId IN (${placeholders(following)})`,
                      [...params, ...following],
                  )
                : [];
            const lockedSet = new Set(locked);
            return new Map(
                rows
                    .filter((row) => !lockedSet.has(row.userId))
                    .sort((a, b) => Number(a.position) - Number(b.position))
                    .map((row, index) => [row.userId, index + 1]),
            );
        }

        const unique = [...new Set(ids)];
        const [rows, lockedRows] = await Promise.all([
            unique.length
                ? this.dataSource.query<
                      { userId: string; position: string | number }[]
                  >(
                      `SELECT userId, position FROM daily_ranking_snapshot
                       WHERE ${filter} AND userId IN (${placeholders(unique)})`,
                      [...params, ...unique],
                  )
                : [],
            locked.length
                ? this.dataSource.query<
                      { userId: string; position: string | number }[]
                  >(
                      `SELECT userId, position FROM daily_ranking_snapshot
                       WHERE ${filter} AND userId IN (${placeholders(locked)})`,
                      [...params, ...locked],
                  )
                : [],
        ]);
        const lockedPositions = lockedRows
            .map((row) => Number(row.position))
            .sort((a, b) => a - b);
        return new Map(
            rows.map((row) => {
                const position = Number(row.position);
                const shift = lockedPositions.filter(
                    (lockedPosition) => lockedPosition < position,
                ).length;
                return [row.userId, position - shift];
            }),
        );
    }

    private async followedIds(userId: string): Promise<string[]> {
        const rows: { followedUserId: string }[] = await this.dataSource.query(
            "SELECT followedUserId FROM user_follow WHERE followerUserId = ?",
            [userId],
        );
        return rows.map((row) => row.followedUserId);
    }

    private async weeklyPuzzle() {
        return this.dataSource
            .getRepository(DailyPuzzle)
            .findOneBy({ kind: "weekly", date: mondayOf(dailyToday()) });
    }

    /** Profiles, badges and the stored `all` streaks for the rows on screen only. */
    private async hydrate(
        items: RankedItem[],
        mode: DailyMode | undefined,
        today: string,
        previous: Map<string, number> | null,
    ): Promise<DailyRankingRowDto[]> {
        if (!items.length) return [];
        const ids = [...new Set(items.map((item) => item.entry.userId))];
        const [profiles, badges, streakRows] = await Promise.all([
            this.dataSource.getRepository(Profile).find({
                where: { userId: In(ids) },
                relations: { avatar: true },
            }),
            this.supporterBadgeIds(ids),
            this.dataSource.query<
                {
                    userId: string;
                    mode: RankingMode;
                    streak: string | number;
                    streakEnd: string | Date | null;
                    bestStreak: string | number;
                }[]
            >(
                `SELECT userId, mode, streak, streakEnd, bestStreak
                 FROM daily_ranking_entry
                 WHERE period = 'all' AND userId IN (${placeholders(ids)})`,
                ids,
            ),
        ]);
        const byId = new Map(
            profiles.map((profile) => [profile.userId, profile]),
        );
        const streaks = new Map<
            string,
            {
                current: number;
                best: Partial<Record<DailyMode, number>>;
            }
        >();
        for (const row of streakRows) {
            const state = streaks.get(row.userId) ?? {
                current: 0,
                best: {},
            };
            if (row.mode === "overall") {
                state.current =
                    row.streakEnd && dayOf(row.streakEnd) >= addDays(today, -1)
                        ? Number(row.streak)
                        : 0;
            } else state.best[row.mode] = Number(row.bestStreak);
            streaks.set(row.userId, state);
        }
        return items.map(({ entry, position }) => {
            const profile = byId.get(entry.userId);
            const playerStreaks = streaks.get(entry.userId);
            return {
                position,
                positionChange: !previous
                    ? null
                    : previous.has(entry.userId)
                      ? previous.get(entry.userId)! - position
                      : "new",
                userId: entry.userId,
                username: profile?.username ?? "",
                avatar: profile?.avatar ?? null,
                supporterBadge: badges.has(entry.userId),
                points: Number(entry.points) / 10,
                winRate: Number(entry.played)
                    ? round((Number(entry.wins) / Number(entry.played)) * 100)
                    : 0,
                ...(mode
                    ? {
                          wins: Number(entry.wins),
                          averageAttempts: Number(entry.wins)
                              ? round(
                                    Number(entry.winAttempts) /
                                        Number(entry.wins),
                                )
                              : null,
                          bestStreak: playerStreaks?.best[mode] ?? 0,
                      }
                    : {
                          modePoints: Object.fromEntries(
                              MODES.map((item) => [
                                  item,
                                  Number(entry[`${item}Points`]) / 10,
                              ]),
                          ) as Record<DailyMode, number>,
                          currentStreak: playerStreaks?.current ?? 0,
                      }),
            };
        });
    }

    /** Entitled supporters among `ids` who have not hidden the badge. */
    private async supporterBadgeIds(ids: string[]) {
        if (!ids.length) return new Set<string>();
        const supporters = new Set(
            await this.billingService.findSupporterUserIds(),
        );
        const candidates = ids.filter((id) => supporters.has(id));
        if (!candidates.length) return new Set<string>();
        const hidden = await this.dataSource
            .getRepository(ProfileSupporterPreferences)
            .find({
                where: { profileUserId: In(candidates), showBadge: false },
                select: { profileUserId: true },
            });
        const hiddenIds = new Set(hidden.map((row) => row.profileUserId));
        return new Set(candidates.filter((id) => !hiddenIds.has(id)));
    }

    /** The 2-point bonus belongs to the mode that finished last on that day. */
    private async bonusForResult(
        userId: string,
        date: string,
        puzzleId: number,
    ) {
        const rows: {
            id: number;
            puzzleId: number;
            mode: DailyMode;
            finishedAt: Date | string;
        }[] = await this.dataSource.query(
            `SELECT r.id AS id, r.puzzleId AS puzzleId, p.mode AS mode,
                    r.finishedAt AS finishedAt
             FROM daily_result r
             JOIN daily_puzzle p ON p.id = r.puzzleId
             WHERE r.userId = ? AND p.kind = 'daily' AND p.date = ?
                   AND r.ranked = 1 AND r.status = ?`,
            [userId, date, DailyStatus.WON],
        );
        const latest = new Map<
            DailyMode,
            { puzzleId: number; finishedAt: number; id: number }
        >();
        for (const row of rows) {
            const finishedAt = new Date(row.finishedAt).getTime();
            const current = latest.get(row.mode);
            if (
                !current ||
                finishedAt > current.finishedAt ||
                (finishedAt === current.finishedAt && row.id > current.id)
            )
                latest.set(row.mode, {
                    puzzleId: row.puzzleId,
                    finishedAt,
                    id: row.id,
                });
        }
        if (latest.size !== MODES.length) return 0;
        const last = [...latest.values()].reduce((a, b) =>
            b.finishedAt > a.finishedAt ||
            (b.finishedAt === a.finishedAt && b.id > a.id)
                ? b
                : a,
        );
        return last.puzzleId === puzzleId ? COMPLETION_BONUS : 0;
    }
}
