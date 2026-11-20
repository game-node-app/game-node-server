import { MigrationInterface, QueryRunner } from "typeorm";

// Matches `searchName` on Game and GameAlternativeName. MySQL recomputes it on every write.
const EXPRESSION =
    "TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(`name`, '[\\'‘’＇]', ''), '[\\\\p{P}\\\\p{S}]+', ' '), '\\\\s+', ' '))";

const COLUMNS = [
    { table: "game", type: "varchar(255)", nullability: "NOT NULL" },
    { table: "game_alternative_name", type: "text", nullability: "NULL" },
];

export class AddGameSearchName1795800000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        // TypeORM only creates its metadata table when the connection loads entities. Migrations
        // can run without them (the migration-chain spec does), and this migration records rows.
        await runner.query(
            `CREATE TABLE IF NOT EXISTS \`typeorm_metadata\` (
                \`type\` varchar(255) NOT NULL,
                \`database\` varchar(255) DEFAULT NULL,
                \`schema\` varchar(255) DEFAULT NULL,
                \`table\` varchar(255) DEFAULT NULL,
                \`name\` varchar(255) DEFAULT NULL,
                \`value\` text
            ) ENGINE=InnoDB`,
        );
        // MySQL commits each ALTER separately, so a retry may start with a column already added.
        for (const { table, type, nullability } of COLUMNS) {
            if (!(await runner.hasColumn(table, "searchName"))) {
                await runner.query(
                    `ALTER TABLE \`${table}\` ADD \`searchName\` ${type} AS (${EXPRESSION}) STORED ${nullability}`,
                );
            }
        }
        // TypeORM compares a generated column's expression through this table, not the server's.
        await this.deleteMetadata(runner);
        await runner.query(
            `INSERT INTO \`typeorm_metadata\` (\`type\`, \`schema\`, \`table\`, \`name\`, \`value\`)
            VALUES ('GENERATED_COLUMN', DATABASE(), 'game', 'searchName', ?),
                   ('GENERATED_COLUMN', DATABASE(), 'game_alternative_name', 'searchName', ?)`,
            [EXPRESSION, EXPRESSION],
        );
    }

    async down(runner: QueryRunner): Promise<void> {
        for (const { table } of COLUMNS) {
            if (await runner.hasColumn(table, "searchName")) {
                await runner.query(
                    `ALTER TABLE \`${table}\` DROP COLUMN \`searchName\``,
                );
            }
        }
        await this.deleteMetadata(runner);
    }

    private async deleteMetadata(runner: QueryRunner): Promise<void> {
        await runner.query(
            `DELETE FROM \`typeorm_metadata\` WHERE \`type\` = 'GENERATED_COLUMN' AND \`name\` = 'searchName'
            AND \`schema\` = DATABASE() AND \`table\` IN ('game', 'game_alternative_name')`,
        );
    }
}
