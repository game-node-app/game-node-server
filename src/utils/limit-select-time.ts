import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { MysqlDriver } from "typeorm/driver/mysql/MysqlDriver";

/**
 * Production request-path SELECTs peak around 9s. Backups (mysqldump) and the Manticore
 * indexer run SELECTs past 2 minutes, so this is set per API session, never globally.
 */
export const API_MAX_SELECT_MS = 15_000;

const logger = new Logger("LimitSelectTime");

/** MySQL aborts read-only SELECTs on this pool's connections after `ms` (ER_QUERY_TIMEOUT). */
export function limitSelectTime(dataSource: DataSource, ms: number) {
    const pool = (dataSource.driver as MysqlDriver).pool;
    const limited = new WeakSet<object>();
    // "acquire" also reaches the connection TypeORM opened before this listener existed.
    // Commands queue per connection, so the SET runs before the caller's first query.
    pool.on("acquire", (connection: any) => {
        if (limited.has(connection)) return;
        limited.add(connection);
        connection.query(
            `SET SESSION max_execution_time = ${ms}`,
            (error: Error | null) => {
                if (!error) return;
                limited.delete(connection);
                logger.warn(`Could not limit SELECT time: ${error.message}`);
            },
        );
    });
}
