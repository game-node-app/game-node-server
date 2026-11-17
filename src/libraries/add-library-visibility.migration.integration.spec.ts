import "reflect-metadata";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createConnection, Connection } from "mysql2/promise";
import { testEnvironment } from "../../test/igdb/helpers/test-environment";
import { createBaselineTables } from "../../test/baseline-schema";
import { AddLibraryVisibility1795600000000 } from "../migrations/1795600000000-AddLibraryVisibility";

const DATABASE = "library_visibility_migration_test";
// Test container credentials from test/igdb/docker-compose.yml; the fixture user only owns igdb_sync_test.
const ADMIN = { user: "root", password: "igdb-test-root" };
const BASELINE_TABLES = [
    "profile",
    "game",
    "library",
    "collection",
    "collection_entry",
    "collection_entry_collections_collection",
];
const INDEX = "IDX_collection_entry_library_visibility";

describe("AddLibraryVisibility migration", () => {
    let source: DataSource;
    let admin: Connection;
    const owner = randomUUID();
    const privateCollection = randomUUID();
    const publicCollection = randomUUID();
    const privateOnlyEntry = randomUUID();
    const noCollectionEntry = randomUUID();
    const publicCollectionEntry = randomUUID();
    const mixedCollectionsEntry = randomUUID();

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
            entities: [resolve(__dirname, "../../**/*.entity.ts")],
            synchronize: false,
        }).initialize();
        await createBaselineTables(source, BASELINE_TABLES);
        await source.query(
            "INSERT INTO `game` (`id`, `name`, `slug`) VALUES (1, 'Fixture game', 'fixture-game')",
        );
        await source.query(`INSERT INTO \`library\` (\`userId\`) VALUES (?)`, [
            owner,
        ]);
        await source.query(
            `INSERT INTO \`collection\` (\`id\`, \`name\`, \`isPublic\`, \`libraryUserId\`)
            VALUES (?, 'Private', 0, ?), (?, 'Public', 1, ?)`,
            [privateCollection, owner, publicCollection, owner],
        );
        for (const entryId of [
            privateOnlyEntry,
            noCollectionEntry,
            publicCollectionEntry,
            mixedCollectionsEntry,
        ]) {
            await source.query(
                `INSERT INTO \`collection_entry\` (\`id\`, \`gameId\`, \`libraryUserId\`)
                VALUES (?, 1, ?)`,
                [entryId, owner],
            );
        }
        await source.query(
            `INSERT INTO \`collection_entry_collections_collection\` (\`collectionEntryId\`, \`collectionId\`)
            VALUES (?, ?), (?, ?), (?, ?), (?, ?)`,
            [
                privateOnlyEntry,
                privateCollection,
                publicCollectionEntry,
                publicCollection,
                mixedCollectionsEntry,
                privateCollection,
                mixedCollectionsEntry,
                publicCollection,
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

    it("runs up, backfills private-only entries and adds the index", async () => {
        const runner = source.createQueryRunner();
        try {
            await new AddLibraryVisibility1795600000000().up(runner);

            const entries = await source.query(
                "SELECT `id`, `visibility` FROM `collection_entry`",
            );
            const visibility = Object.fromEntries(
                entries.map((entry: any) => [entry.id, entry.visibility]),
            );
            expect(visibility).toEqual({
                [privateOnlyEntry]: "private",
                [noCollectionEntry]: "public",
                [publicCollectionEntry]: "public",
                [mixedCollectionsEntry]: "public",
            });

            const columns = await source.query(
                `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_DEFAULT FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND ((TABLE_NAME = 'collection_entry' AND COLUMN_NAME = 'visibility')
                    OR (TABLE_NAME = 'profile' AND COLUMN_NAME = 'libraryVisibility'))`,
            );
            expect(
                columns
                    .map((column: any) => [
                        column.TABLE_NAME,
                        column.COLUMN_NAME,
                        column.COLUMN_DEFAULT,
                    ])
                    .sort(),
            ).toEqual([
                ["collection_entry", "visibility", "public"],
                ["profile", "libraryVisibility", "public"],
            ]);

            const index = await source.query(
                `SELECT COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'collection_entry'
                  AND INDEX_NAME = ?
                ORDER BY SEQ_IN_INDEX`,
                [INDEX],
            );
            expect(
                index.map((row: any) => [
                    row.COLUMN_NAME,
                    Number(row.NON_UNIQUE),
                ]),
            ).toEqual([
                ["libraryUserId", 1],
                ["visibility", 1],
            ]);
        } finally {
            await runner.release();
        }
    });

    it("runs down and removes the columns and index without touching entries", async () => {
        const runner = source.createQueryRunner();
        try {
            await new AddLibraryVisibility1795600000000().down(runner);

            const columns = await source.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND ((TABLE_NAME = 'collection_entry' AND COLUMN_NAME = 'visibility')
                    OR (TABLE_NAME = 'profile' AND COLUMN_NAME = 'libraryVisibility'))`,
            );
            expect(columns).toEqual([]);

            const index = await source.query(
                `SELECT INDEX_NAME FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'collection_entry'
                  AND INDEX_NAME = ?`,
                [INDEX],
            );
            expect(index).toEqual([]);

            const [{ count }] = await source.query(
                "SELECT COUNT(*) AS count FROM `collection_entry`",
            );
            expect(Number(count)).toBe(4);
        } finally {
            await runner.release();
        }
    });
});
