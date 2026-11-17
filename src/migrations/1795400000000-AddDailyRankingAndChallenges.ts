import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Design 1, 2, 3, 7, 8: puzzle kind, ranking columns with the same-day backfill, practice
 * rounds and the derived ranking entry/snapshot tables (filled by `rebuild`, not here).
 * `down` fails if weekly puzzles exist: delete them and their results first.
 *
 * MySQL commits DDL implicitly, so a failed run leaves the steps before the failure applied and
 * TypeORM cannot roll them back. Every step therefore checks its own effect first, which makes a
 * retry after a partial failure finish the rest instead of failing on "Duplicate column".
 */
export class AddDailyRankingAndChallenges1795400000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        if (!(await runner.hasColumn("daily_puzzle", "kind")))
            await runner.query(
                "ALTER TABLE `daily_puzzle` ADD COLUMN `kind` varchar(16) NOT NULL DEFAULT 'daily' AFTER `id`, DROP INDEX `UQ_daily_puzzle_mode_date`, DROP INDEX `UQ_daily_puzzle_mode_number`, ADD UNIQUE KEY `UQ_daily_puzzle_kind_mode_date` (`kind`, `mode`, `date`), ADD UNIQUE KEY `UQ_daily_puzzle_kind_mode_number` (`kind`, `mode`, `number`), ADD KEY `IDX_daily_puzzle_kind_date` (`kind`, `date`)",
            );
        if (!(await runner.hasColumn("daily_result", "ranked")))
            await runner.query(
                "ALTER TABLE `daily_result` ADD COLUMN `ranked` tinyint NOT NULL DEFAULT '0' AFTER `status`, ADD COLUMN `points` smallint unsigned NOT NULL DEFAULT '0' AFTER `ranked`",
            );
        await runner.query(
            "CREATE TABLE IF NOT EXISTS `daily_practice_round` (`id` char(36) NOT NULL, `userId` varchar(36) NULL DEFAULT NULL, `mode` varchar(16) NOT NULL, `gameId` bigint NOT NULL, `meta` json NOT NULL, `guesses` json NOT NULL, `hintAt` int NULL DEFAULT NULL, `status` varchar(16) NOT NULL, `attempts` int NOT NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `finishedAt` datetime NULL DEFAULT NULL, PRIMARY KEY (`id`), KEY `IDX_daily_practice_round_createdAt` (`createdAt`), KEY `FK_daily_practice_round_profile` (`userId`), KEY `FK_daily_practice_round_game` (`gameId`), CONSTRAINT `FK_daily_practice_round_profile` FOREIGN KEY (`userId`) REFERENCES `profile` (`userId`) ON DELETE CASCADE, CONSTRAINT `FK_daily_practice_round_game` FOREIGN KEY (`gameId`) REFERENCES `game` (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
        // The order index is the spec's ORDER BY; a deleted account loses its entries with the profile.
        await runner.query(
            "CREATE TABLE IF NOT EXISTS `daily_ranking_entry` (`period` varchar(8) NOT NULL, `periodStart` date NOT NULL, `mode` varchar(16) NOT NULL, `userId` varchar(36) NOT NULL, `points` int unsigned NOT NULL DEFAULT '0', `coverPoints` int unsigned NOT NULL DEFAULT '0', `artworkPoints` int unsigned NOT NULL DEFAULT '0', `keywordsPoints` int unsigned NOT NULL DEFAULT '0', `specsPoints` int unsigned NOT NULL DEFAULT '0', `wins` int unsigned NOT NULL DEFAULT '0', `played` int unsigned NOT NULL DEFAULT '0', `winAttempts` int unsigned NOT NULL DEFAULT '0', `lastFinishedAt` datetime NOT NULL, `prevPoints` int unsigned NOT NULL DEFAULT '0', `prevPlayed` int unsigned NOT NULL DEFAULT '0', `prevWinAttempts` int unsigned NOT NULL DEFAULT '0', `prevLastFinishedAt` datetime NULL DEFAULT NULL, `asOf` date NOT NULL, `streak` int unsigned NOT NULL DEFAULT '0', `streakEnd` date NULL DEFAULT NULL, `bestStreak` int unsigned NOT NULL DEFAULT '0', PRIMARY KEY (`period`, `periodStart`, `mode`, `userId`), KEY `IDX_daily_ranking_entry_order` (`period`, `periodStart`, `mode`, `points` DESC, `winAttempts`, `lastFinishedAt`, `userId`), KEY `FK_daily_ranking_entry_profile` (`userId`), CONSTRAINT `FK_daily_ranking_entry_profile` FOREIGN KEY (`userId`) REFERENCES `profile` (`userId`) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
        // No FK: cleanup removes old snapshots, and a deleted account only leaves a gap.
        await runner.query(
            "CREATE TABLE IF NOT EXISTS `daily_ranking_snapshot` (`period` varchar(8) NOT NULL, `periodStart` date NOT NULL, `mode` varchar(16) NOT NULL, `date` date NOT NULL, `userId` varchar(36) NOT NULL, `position` int unsigned NOT NULL, PRIMARY KEY (`period`, `periodStart`, `mode`, `date`, `userId`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
        // Numeric offsets need no time zone tables; -03:00 is the São Paulo offset (dailyNextResetAt).
        await runner.query(
            `UPDATE daily_result r JOIN daily_puzzle p ON p.id = r.puzzleId
            SET r.ranked = 1,
                r.points = IF(r.status = 'won', IF(p.mode = 'specs', 6 * (11 - r.attempts), 10 * (7 - r.attempts)), 0)
            WHERE r.status <> 'in_progress' AND r.finishedAt IS NOT NULL
              AND DATE(CONVERT_TZ(r.finishedAt, '+00:00', '-03:00')) = p.date`,
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        // Checked before anything is dropped: re-adding the old unique keys fails with weekly rows.
        // Skipped when `kind` is already gone, i.e. when this is a retry of a partial revert.
        if (await runner.hasColumn("daily_puzzle", "kind")) {
            const [weekly] = await runner.query(
                "SELECT COUNT(*) AS total FROM `daily_puzzle` WHERE `kind` = 'weekly'",
            );
            if (Number(weekly.total) > 0)
                throw new Error(
                    "Delete the weekly puzzles and their results before reverting AddDailyRankingAndChallenges",
                );
        }
        await runner.query("DROP TABLE IF EXISTS `daily_ranking_snapshot`");
        await runner.query("DROP TABLE IF EXISTS `daily_ranking_entry`");
        await runner.query("DROP TABLE IF EXISTS `daily_practice_round`");
        if (await runner.hasColumn("daily_puzzle", "kind"))
            await runner.query(
                "ALTER TABLE `daily_puzzle` DROP INDEX `UQ_daily_puzzle_kind_mode_date`, DROP INDEX `UQ_daily_puzzle_kind_mode_number`, DROP INDEX `IDX_daily_puzzle_kind_date`, DROP COLUMN `kind`, ADD UNIQUE KEY `UQ_daily_puzzle_mode_date` (`mode`, `date`), ADD UNIQUE KEY `UQ_daily_puzzle_mode_number` (`mode`, `number`)",
            );
        if (await runner.hasColumn("daily_result", "ranked"))
            await runner.query(
                "ALTER TABLE `daily_result` DROP COLUMN `ranked`, DROP COLUMN `points`",
            );
    }
}
