import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandGameUrlColumn1793208042000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            "ALTER TABLE `game` MODIFY `url` text NULL",
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        const rows = (await queryRunner.query(
            "SELECT COUNT(*) AS count FROM `game` WHERE CHAR_LENGTH(`url`) > 255",
        )) as Array<{ count: number | string }>;
        if (Number(rows[0]?.count ?? 0) > 0)
            throw new Error(
                "Cannot shrink game.url to varchar(255): longer URLs exist",
            );
        await queryRunner.query(
            "ALTER TABLE `game` MODIFY `url` varchar(255) NULL",
        );
    }
}
