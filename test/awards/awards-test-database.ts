import "reflect-metadata";
import { resolve } from "node:path";
import { createConnection, Connection } from "mysql2/promise";
import { DataSource } from "typeorm";
import { testEnvironment } from "../igdb/helpers/test-environment";

// Same fixture credentials the migration integration spec uses; the igdb_test user only owns igdb_sync_test.
const ADMIN = { user: "root", password: "igdb-test-root" };

/**
 * Dedicated database per Awards spec, so these suites never synchronize or clean the shared igdb_sync_test schema.
 */
export async function createAwardsTestDatabase(database: string) {
    const mysql = testEnvironment(process.env).mysql;
    const admin: Connection = await createConnection({
        host: mysql.host,
        port: mysql.port,
        ...ADMIN,
    });
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(`CREATE DATABASE \`${database}\``);

    const source = await new DataSource({
        type: "mysql",
        host: mysql.host,
        port: mysql.port,
        username: ADMIN.user,
        password: ADMIN.password,
        database,
        timezone: "Z",
        dateStrings: ["DATE"],
        bigNumberStrings: false,
        entities: [resolve(__dirname, "../../src/**/*.entity.ts")],
        synchronize: false,
    }).initialize();

    // The notification harness skips these two for the same reason: their DDL does not match the decorators yet.
    source.getMetadata("UserConnectionCredential").synchronize = false;
    source.getMetadata("PsnSystemCredential").synchronize = false;
    await source.synchronize();

    return {
        source,
        async destroy() {
            if (source.isInitialized) await source.destroy();
            await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
            await admin.end();
        },
    };
}
