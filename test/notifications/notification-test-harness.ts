import "reflect-metadata";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import { testEnvironment } from "../igdb/helpers/test-environment";

export async function createNotificationTestDataSource(): Promise<DataSource> {
    const settings = testEnvironment(process.env);
    const source = await new DataSource({
        ...settings.mysql,
        timezone: "Z",
        entities: [resolve(__dirname, "../../src/**/*.entity.ts")],
    }).initialize();
    try {
        // shortcut: omit unused credential DDL with mismatched precision, remove when its decorator matches its migration
        source.getMetadata("UserConnectionCredential").synchronize = false;
        await source.synchronize();
        await source.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (1, 'Notification fixture', 'notification-fixture')",
        );
        return source;
    } catch (error) {
        await source.destroy();
        throw error;
    }
}
