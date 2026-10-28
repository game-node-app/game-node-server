import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { CreateImporterBatchEffects1792960197572 } from "../migrations/1792960197572-CreateImporterBatchEffects";

const mysqlDescribe = process.env.PLAYER_IMPORT_TEST_MYSQL_PORT
    ? describe
    : describe.skip;
mysqlDescribe("batch effect migration", () => {
    it("creates and rolls back the recovery table", async () => {
        const database = `import_effect_test_${randomUUID().replaceAll("-", "")}`;
        const options = {
            type: "mysql" as const,
            host: "127.0.0.1",
            port: Number(process.env.PLAYER_IMPORT_TEST_MYSQL_PORT),
            username: "root",
            password: "",
        };
        const admin = await new DataSource(options).initialize();
        let source: DataSource | undefined;
        try {
            await admin.query(`CREATE DATABASE \`${database}\``);
            source = await new DataSource({
                ...options,
                database,
            }).initialize();
            await source.query(
                "CREATE TABLE library (userId varchar(36) NOT NULL PRIMARY KEY)",
            );
            const runner = source.createQueryRunner();
            try {
                const migration = new CreateImporterBatchEffects1792960197572();
                await migration.up(runner);
                expect(await runner.hasTable("importer_batch_effect")).toBe(
                    true,
                );
                await migration.down(runner);
                expect(await runner.hasTable("importer_batch_effect")).toBe(
                    false,
                );
            } finally {
                await runner.release();
            }
        } finally {
            await source?.destroy();
            await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
            await admin.destroy();
        }
    }, 120000);
});
