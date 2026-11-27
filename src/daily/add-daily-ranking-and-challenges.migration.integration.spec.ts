import "reflect-metadata";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import { createConnection, Connection } from "mysql2/promise";
import { testEnvironment } from "../../test/igdb/helpers/test-environment";
import { createBaselineTables } from "../../test/baseline-schema";
import { AddDaily1794400000000 } from "../migrations/1794400000000-AddDaily";
import { AddDailyRankingAndChallenges1795600000000 } from "../migrations/1795600000000-AddDailyRankingAndChallenges";
import { DailyPracticeRound } from "./entity/daily-practice-round.entity";
import { DailyRankingEntry } from "./entity/daily-ranking-entry.entity";
import { DailyRankingSnapshot } from "./entity/daily-ranking-snapshot.entity";
import { dailyPoints, DailyMode, DailyStatus } from "./daily.constants";

const DATABASE = "daily_ranking_migration_test";
// Test container credentials from test/igdb/docker-compose.yml; the fixture user only owns igdb_sync_test.
const ADMIN = { user: "root", password: "igdb-test-root" };

const userIds = Array.from(
    { length: 6 },
    (_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`,
);

interface Fixture {
    userId: string;
    puzzleId: number;
    mode: DailyMode;
    status: DailyStatus;
    attempts: number;
    finishedAt: string | null;
    guesses: (number | null)[];
    ranked: boolean;
}

const FIXTURES: Fixture[] = [
    // 23:59 on the puzzle date in São Paulo (02:59 UTC the next day) counts.
    {
        userId: userIds[0],
        puzzleId: 1,
        mode: DailyMode.COVER,
        status: DailyStatus.WON,
        attempts: 3,
        finishedAt: "2026-03-11 02:59:00",
        guesses: [7, 8, 1],
        ranked: true,
    },
    {
        userId: userIds[1],
        puzzleId: 2,
        mode: DailyMode.ARTWORK,
        status: DailyStatus.WON,
        attempts: 2,
        finishedAt: "2026-03-10 12:00:00",
        guesses: [null, 2],
        ranked: true,
    },
    // Hint after five guesses, then a win on the sixth: seven attempts.
    {
        userId: userIds[2],
        puzzleId: 3,
        mode: DailyMode.SPECS,
        status: DailyStatus.WON,
        attempts: 7,
        finishedAt: "2026-03-10 15:30:00",
        guesses: [4, 5, 6, 7, 8, 3],
        ranked: true,
    },
    {
        userId: userIds[3],
        puzzleId: 1,
        mode: DailyMode.COVER,
        status: DailyStatus.LOST,
        attempts: 6,
        finishedAt: "2026-03-10 23:00:00",
        guesses: [7, 8, 7, 8, 7, 8],
        ranked: true,
    },
    // 00:01 the next day in São Paulo (03:01 UTC) no longer counts.
    {
        userId: userIds[4],
        puzzleId: 1,
        mode: DailyMode.COVER,
        status: DailyStatus.WON,
        attempts: 2,
        finishedAt: "2026-03-11 03:01:00",
        guesses: [7, 1],
        ranked: false,
    },
    {
        userId: userIds[5],
        puzzleId: 1,
        mode: DailyMode.COVER,
        status: DailyStatus.IN_PROGRESS,
        attempts: 1,
        finishedAt: null,
        guesses: [7],
        ranked: false,
    },
];

describe("AddDailyRankingAndChallenges migration", () => {
    let source: DataSource;
    let admin: Connection;

    beforeAll(async () => {
        const mysql = testEnvironment(process.env).mysql;
        admin = await createConnection({
            host: mysql.host,
            port: mysql.port,
            ...ADMIN,
        });
        await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
        await admin.query(`CREATE DATABASE \`${DATABASE}\``);
        source = await new DataSource({
            type: "mysql",
            host: mysql.host,
            port: mysql.port,
            username: ADMIN.user,
            password: ADMIN.password,
            database: DATABASE,
            timezone: "Z",
            dateStrings: ["DATE"],
            entities: [resolve(__dirname, "../**/*.entity.ts")],
            synchronize: false,
        }).initialize();
        await createBaselineTables(source, ["profile", "game"]);
        const setup = source.createQueryRunner();
        try {
            await new AddDaily1794400000000().up(setup);
        } finally {
            await setup.release();
        }
        await source.query(
            "INSERT INTO game (id, name, slug) VALUES (1, 'Game A', 'game-a'), (2, 'Game B', 'game-b'), (3, 'Game C', 'game-c')",
        );
        for (const [index, userId] of userIds.entries())
            await source.query(
                "INSERT INTO profile (userId, username) VALUES (?, ?)",
                [userId, `daily_migration_${index}`],
            );
        await source.query(
            `INSERT INTO daily_puzzle (id, mode, number, date, gameId, meta, source) VALUES
            (1, 'cover', 9001, '2026-03-10', 1, '{}', 'admin'),
            (2, 'artwork', 9001, '2026-03-10', 2, '{}', 'admin'),
            (3, 'specs', 9001, '2026-03-10', 3, '{}', 'admin')`,
        );
        for (const fixture of FIXTURES)
            await source.query(
                `INSERT INTO daily_result (userId, puzzleId, guesses, hintAt, status, attempts, finishedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    fixture.userId,
                    fixture.puzzleId,
                    JSON.stringify(fixture.guesses),
                    fixture.mode === DailyMode.SPECS ? 5 : null,
                    fixture.status,
                    fixture.attempts,
                    fixture.finishedAt,
                ],
            );
    });

    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
        if (admin) {
            await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
            await admin.end();
        }
    });

    const indexes = async (
        table: string,
    ): Promise<{ name: string; unique: boolean; columns: string[] }[]> => {
        const rows = await source.query(
            `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            GROUP BY INDEX_NAME, NON_UNIQUE`,
            [table],
        );
        return rows.map((row: any) => ({
            name: row.name,
            unique: Number(row.nonUnique) === 0,
            columns: String(row.columns).split(","),
        }));
    };

    /** Index columns with MySQL's sort direction, to pin the mixed DESC order. */
    const indexDirections = async (table: string, name: string) => {
        const rows = await source.query(
            `SELECT COLUMN_NAME AS name, COLLATION AS direction
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
            ORDER BY SEQ_IN_INDEX`,
            [table, name],
        );
        return rows.map((row: any) => `${row.name}:${row.direction}`);
    };

    const foreignKeys = async (table: string) => {
        const rows = await source.query(
            `SELECT CONSTRAINT_NAME AS name, DELETE_RULE AS onDelete
            FROM information_schema.REFERENTIAL_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [table],
        );
        return rows.map((row: any) => ({
            name: row.name,
            onDelete: row.onDelete,
        }));
    };

    it("runs up, adds the schema and backfills same-day results only", async () => {
        const runner = source.createQueryRunner();
        try {
            await new AddDailyRankingAndChallenges1795600000000().up(runner);

            const puzzleIndexes = await indexes("daily_puzzle");
            expect(puzzleIndexes).toEqual(
                expect.arrayContaining([
                    {
                        name: "UQ_daily_puzzle_kind_mode_date",
                        unique: true,
                        columns: ["kind", "mode", "date"],
                    },
                    {
                        name: "UQ_daily_puzzle_kind_mode_number",
                        unique: true,
                        columns: ["kind", "mode", "number"],
                    },
                    {
                        name: "IDX_daily_puzzle_kind_date",
                        unique: false,
                        columns: ["kind", "date"],
                    },
                ]),
            );
            expect(puzzleIndexes.map((index) => index.name)).not.toEqual(
                expect.arrayContaining([
                    "UQ_daily_puzzle_mode_date",
                    "UQ_daily_puzzle_mode_number",
                ]),
            );

            const resultColumns = await source.query(
                `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_result'
                  AND COLUMN_NAME IN ('ranked', 'points') ORDER BY COLUMN_NAME`,
            );
            expect(resultColumns).toEqual([
                { COLUMN_NAME: "points", COLUMN_TYPE: "smallint unsigned" },
                { COLUMN_NAME: "ranked", COLUMN_TYPE: "tinyint" },
            ]);

            expect(await runner.hasTable("daily_practice_round")).toBe(true);
            const practice = await runner.getTable("daily_practice_round");
            const metadata = source.getMetadata(DailyPracticeRound);
            expect(
                practice?.columns.map((column) => column.name).sort(),
            ).toEqual(
                metadata.columns.map((column) => column.databaseName).sort(),
            );
            expect(await indexes("daily_practice_round")).toEqual(
                expect.arrayContaining([
                    {
                        name: "IDX_daily_practice_round_createdAt",
                        unique: false,
                        columns: ["createdAt"],
                    },
                ]),
            );

            expect(await runner.hasTable("daily_ranking_entry")).toBe(true);
            const entry = await runner.getTable("daily_ranking_entry");
            expect(entry?.columns.map((column) => column.name).sort()).toEqual(
                source
                    .getMetadata(DailyRankingEntry)
                    .columns.map((column) => column.databaseName)
                    .sort(),
            );
            expect(await indexes("daily_ranking_entry")).toEqual(
                expect.arrayContaining([
                    {
                        name: "PRIMARY",
                        unique: true,
                        columns: ["period", "periodStart", "mode", "userId"],
                    },
                    {
                        name: "IDX_daily_ranking_entry_order",
                        unique: false,
                        columns: [
                            "period",
                            "periodStart",
                            "mode",
                            "points",
                            "winAttempts",
                            "lastFinishedAt",
                            "userId",
                        ],
                    },
                ]),
            );
            expect(
                await indexDirections(
                    "daily_ranking_entry",
                    "IDX_daily_ranking_entry_order",
                ),
            ).toEqual([
                "period:A",
                "periodStart:A",
                "mode:A",
                "points:D",
                "winAttempts:A",
                "lastFinishedAt:A",
                "userId:A",
            ]);
            expect(await foreignKeys("daily_ranking_entry")).toEqual([
                {
                    name: "FK_daily_ranking_entry_profile",
                    onDelete: "CASCADE",
                },
            ]);

            expect(await runner.hasTable("daily_ranking_snapshot")).toBe(true);
            const snapshot = await runner.getTable("daily_ranking_snapshot");
            expect(
                snapshot?.columns.map((column) => column.name).sort(),
            ).toEqual(
                source
                    .getMetadata(DailyRankingSnapshot)
                    .columns.map((column) => column.databaseName)
                    .sort(),
            );
            expect(await indexes("daily_ranking_snapshot")).toEqual([
                {
                    name: "PRIMARY",
                    unique: true,
                    columns: [
                        "period",
                        "periodStart",
                        "mode",
                        "date",
                        "userId",
                    ],
                },
            ]);
            expect(await foreignKeys("daily_ranking_snapshot")).toEqual([]);

            for (const fixture of FIXTURES) {
                const [row] = await source.query(
                    "SELECT ranked, points, status, attempts, guesses FROM daily_result WHERE userId = ?",
                    [fixture.userId],
                );
                expect({
                    ranked: Number(row.ranked),
                    points: Number(row.points),
                }).toEqual({
                    ranked: fixture.ranked ? 1 : 0,
                    points: fixture.ranked
                        ? dailyPoints(
                              fixture.mode,
                              fixture.status,
                              fixture.attempts,
                          )
                        : 0,
                });
                expect(row.status).toBe(fixture.status);
                expect(Number(row.attempts)).toBe(fixture.attempts);
                expect(
                    typeof row.guesses === "string"
                        ? JSON.parse(row.guesses)
                        : row.guesses,
                ).toEqual(fixture.guesses);
            }

            const puzzles = await source.query(
                "SELECT id, mode, number, date, gameId FROM daily_puzzle ORDER BY id",
            );
            expect(
                puzzles.map((row: any) => ({
                    id: row.id,
                    mode: row.mode,
                    number: row.number,
                    date: row.date,
                    gameId: Number(row.gameId),
                })),
            ).toEqual([
                {
                    id: 1,
                    mode: "cover",
                    number: 9001,
                    date: "2026-03-10",
                    gameId: 1,
                },
                {
                    id: 2,
                    mode: "artwork",
                    number: 9001,
                    date: "2026-03-10",
                    gameId: 2,
                },
                {
                    id: 3,
                    mode: "specs",
                    number: 9001,
                    date: "2026-03-10",
                    gameId: 3,
                },
            ]);
        } finally {
            await runner.release();
        }
    });

    it("walks the order index for the page query without a filesort", async () => {
        const ids = Array.from(
            { length: 500 },
            (_, index) =>
                `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`,
        );
        for (let index = 0; index < ids.length; index += 100) {
            const chunk = ids.slice(index, index + 100);
            await source.query(
                `INSERT INTO profile (userId, username) VALUES
                ${chunk.map(() => "(?, ?)").join(", ")}`,
                chunk.flatMap((userId, offset) => [
                    userId,
                    `explain_${index + offset + 1}`,
                ]),
            );
            await source.query(
                `INSERT INTO daily_ranking_entry
                (period, periodStart, mode, userId, points, winAttempts, lastFinishedAt, asOf)
                VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
                chunk.flatMap((userId, offset) => [
                    "week",
                    "2026-03-02",
                    "overall",
                    userId,
                    5000 - (index + offset),
                    (index + offset) % 6,
                    "2026-03-04 12:00:00",
                    "2026-03-04",
                ]),
            );
        }

        const [plan] = await source.query(
            `EXPLAIN SELECT userId, points, winAttempts, lastFinishedAt
            FROM daily_ranking_entry
            WHERE period = ? AND periodStart = ? AND mode = ?
            ORDER BY points DESC, winAttempts, lastFinishedAt, userId
            LIMIT 10`,
            ["week", "2026-03-02", "overall"],
        );
        expect(plan.key).toBe("IDX_daily_ranking_entry_order");
        expect(String(plan.Extra)).not.toContain("filesort");
    });

    it("runs down and restores the old schema, keeping the rows", async () => {
        const runner = source.createQueryRunner();
        try {
            await new AddDailyRankingAndChallenges1795600000000().down(runner);

            expect(await runner.hasTable("daily_ranking_entry")).toBe(false);
            expect(await runner.hasTable("daily_ranking_snapshot")).toBe(false);
            expect(await runner.hasTable("daily_practice_round")).toBe(false);
            const puzzle = await runner.getTable("daily_puzzle");
            expect(puzzle?.columns.map((column) => column.name)).not.toEqual(
                expect.arrayContaining(["kind"]),
            );
            expect(await indexes("daily_puzzle")).toEqual(
                expect.arrayContaining([
                    {
                        name: "UQ_daily_puzzle_mode_date",
                        unique: true,
                        columns: ["mode", "date"],
                    },
                    {
                        name: "UQ_daily_puzzle_mode_number",
                        unique: true,
                        columns: ["mode", "number"],
                    },
                ]),
            );
            expect(
                (await indexes("daily_puzzle")).map((index) => index.name),
            ).not.toEqual(
                expect.arrayContaining(["IDX_daily_puzzle_kind_date"]),
            );
            const result = await runner.getTable("daily_result");
            expect(result?.columns.map((column) => column.name)).not.toEqual(
                expect.arrayContaining(["ranked", "points"]),
            );
            const [count] = await source.query(
                "SELECT COUNT(*) AS total FROM daily_result",
            );
            expect(Number(count.total)).toBe(FIXTURES.length);
        } finally {
            await runner.release();
        }
    });

    // MySQL commits DDL implicitly, so a failed deploy leaves the early steps applied.
    it("finishes after a partial run and is a no-op when run again", async () => {
        const migration = new AddDailyRankingAndChallenges1795600000000();
        const runner = source.createQueryRunner();
        try {
            // State after a run that died after its first two steps.
            await runner.query(
                "ALTER TABLE `daily_puzzle` ADD COLUMN `kind` varchar(16) NOT NULL DEFAULT 'daily' AFTER `id`, DROP INDEX `UQ_daily_puzzle_mode_date`, DROP INDEX `UQ_daily_puzzle_mode_number`, ADD UNIQUE KEY `UQ_daily_puzzle_kind_mode_date` (`kind`, `mode`, `date`), ADD UNIQUE KEY `UQ_daily_puzzle_kind_mode_number` (`kind`, `mode`, `number`), ADD KEY `IDX_daily_puzzle_kind_date` (`kind`, `date`)",
            );
            await runner.query(
                "ALTER TABLE `daily_result` ADD COLUMN `ranked` tinyint NOT NULL DEFAULT '0' AFTER `status`, ADD COLUMN `points` smallint unsigned NOT NULL DEFAULT '0' AFTER `ranked`",
            );

            await migration.up(runner);
            const counted = () =>
                source.query(
                    "SELECT userId, puzzleId, ranked, points FROM daily_result ORDER BY userId, puzzleId",
                );
            const afterFirst = await counted();
            expect(afterFirst.filter((row: any) => row.ranked)).toHaveLength(
                FIXTURES.filter((fixture) => fixture.ranked).length,
            );

            await migration.up(runner);
            expect(await counted()).toEqual(afterFirst);
            for (const table of [
                "daily_ranking_entry",
                "daily_ranking_snapshot",
                "daily_practice_round",
            ])
                expect(await runner.hasTable(table)).toBe(true);
        } finally {
            await runner.release();
        }
    });

    it("refuses to revert while weekly puzzles exist and drops nothing", async () => {
        const migration = new AddDailyRankingAndChallenges1795600000000();
        await source.query(
            "INSERT INTO daily_puzzle (id, kind, mode, number, date, gameId, meta, source) VALUES (900, 'weekly', 'cover', 1, '2026-03-09', 1, '{}', 'admin')",
        );
        const runner = source.createQueryRunner();
        try {
            await expect(migration.down(runner)).rejects.toThrow(/weekly/);
            expect(await runner.hasTable("daily_ranking_entry")).toBe(true);
            expect(await runner.hasColumn("daily_puzzle", "kind")).toBe(true);

            await source.query("DELETE FROM daily_puzzle WHERE id = 900");
            await migration.down(runner);
            // A retry of a finished revert must not fail either.
            await migration.down(runner);
            expect(await runner.hasColumn("daily_puzzle", "kind")).toBe(false);
            expect(await runner.hasTable("daily_ranking_entry")).toBe(false);
        } finally {
            await runner.release();
        }
    });
});
