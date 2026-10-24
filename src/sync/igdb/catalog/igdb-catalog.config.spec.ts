import { catalogConfig } from "./igdb-catalog.config";

describe("catalogConfig", () => {
    it("uses the specified disabled defaults", () => {
        expect(catalogConfig({})).toEqual({
            enabled: false,
            intervalDays: 7,
            batchSize: 25,
            gameConcurrency: 1,
            relationConcurrency: 2,
            httpTimeoutMs: 30_000,
            maxResponseBytes: 16_777_216,
            maxAttempts: 3,
        });
    });

    const ranges = [
        ["IGDB_CATALOG_BATCH_SIZE", "batchSize", 1, 500],
        ["IGDB_CATALOG_GAME_CONCURRENCY", "gameConcurrency", 1, 2],
        ["IGDB_CATALOG_RELATION_CONCURRENCY", "relationConcurrency", 1, 2],
        ["IGDB_CATALOG_HTTP_TIMEOUT_MS", "httpTimeoutMs", 1000, 60000],
        [
            "IGDB_CATALOG_MAX_RESPONSE_BYTES",
            "maxResponseBytes",
            1048576,
            67108864,
        ],
        ["IGDB_CATALOG_MAX_ATTEMPTS", "maxAttempts", 1, 5],
    ] as const;
    it.each(ranges)(
        "validates both endpoints for %s",
        (key, field, min, max) => {
            for (const endpoint of [min, max]) {
                expect(catalogConfig({ [key]: String(endpoint) })[field]).toBe(
                    endpoint,
                );
            }
            for (const invalid of [
                String(min - 1),
                String(max + 1),
                "1.5",
                "1junk",
                "",
                " 1",
                "1 ",
                "1e3",
                "NaN",
            ]) {
                expect(() => catalogConfig({ [key]: invalid })).toThrow(key);
            }
        },
    );

    it.each(["1", "0", "TRUE", "yes", "", "false "])(
        "rejects invalid boolean %j",
        (value) => {
            expect(() =>
                catalogConfig({ IGDB_CATALOG_ENABLED: value }),
            ).toThrow("IGDB_CATALOG_ENABLED");
        },
    );

    it("accepts only seven or fourteen days", () => {
        expect(
            catalogConfig({
                IGDB_CATALOG_ENABLED: "true",
                IGDB_CATALOG_INTERVAL_DAYS: "14",
            }),
        ).toMatchObject({ enabled: true, intervalDays: 14 });
        for (const value of ["6", "8", "13", "15", "7.5", "7junk"]) {
            expect(() =>
                catalogConfig({ IGDB_CATALOG_INTERVAL_DAYS: value }),
            ).toThrow("IGDB_CATALOG_INTERVAL_DAYS");
        }
    });
});
