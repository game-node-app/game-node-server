import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDaily1794400000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "CREATE TABLE `daily_puzzle` (`id` int NOT NULL AUTO_INCREMENT, `mode` varchar(16) NOT NULL, `number` int NOT NULL, `date` date NOT NULL, `gameId` bigint NOT NULL, `meta` json NOT NULL, `source` varchar(16) NOT NULL DEFAULT 'auto', `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`), UNIQUE KEY `UQ_daily_puzzle_mode_date` (`mode`, `date`), UNIQUE KEY `UQ_daily_puzzle_mode_number` (`mode`, `number`), CONSTRAINT `FK_daily_puzzle_game` FOREIGN KEY (`gameId`) REFERENCES `game` (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
        await runner.query(
            "CREATE TABLE `daily_result` (`id` int NOT NULL AUTO_INCREMENT, `userId` varchar(36) NOT NULL, `puzzleId` int NOT NULL, `guesses` json NOT NULL, `hintAt` int NULL, `status` varchar(16) NOT NULL, `attempts` int NOT NULL, `finishedAt` datetime NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`), UNIQUE KEY `UQ_daily_result_user_puzzle` (`userId`, `puzzleId`), CONSTRAINT `FK_daily_result_profile` FOREIGN KEY (`userId`) REFERENCES `profile` (`userId`) ON DELETE CASCADE, CONSTRAINT `FK_daily_result_puzzle` FOREIGN KEY (`puzzleId`) REFERENCES `daily_puzzle` (`id`) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `daily_result`");
        await runner.query("DROP TABLE `daily_puzzle`");
    }
}
