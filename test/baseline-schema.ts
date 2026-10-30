import { DataSource } from "typeorm";
import { InitialSchema1793500000000 } from "../src/migrations/1793500000000-InitialSchema";

/**
 * Creates only `tables` from the baseline (plus their seed rows). Foreign keys to tables
 * outside the set are dropped so fixtures do not need unrelated parent rows.
 */
export async function createBaselineTables(
    source: DataSource,
    tables: string[],
) {
    const statements: string[] = [];
    await new InitialSchema1793500000000().up({
        query: async (sql: string) => void statements.push(sql),
    } as any);
    const keepsReference = (line: string) =>
        !/REFERENCES `([^`]+)`/.test(line) ||
        tables.includes(/REFERENCES `([^`]+)`/.exec(line)![1]);
    const runner = source.createQueryRunner();
    try {
        await runner.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const sql of statements) {
            const created = /^CREATE TABLE `([^`]+)`/.exec(sql)?.[1];
            const seeded = /^INSERT INTO (\w+)/.exec(sql)?.[1];
            if (!tables.includes(created ?? seeded ?? "")) continue;
            await runner.query(
                created
                    ? sql
                          .split("\n")
                          .filter(keepsReference)
                          .join("\n")
                          .replace(/,\n\)/, "\n)")
                    : sql,
            );
        }
        await runner.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        await runner.release();
    }
}
