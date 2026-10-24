export const CATALOG_TIMING = {
    leaseMs: 120_000,
    heartbeatMs: 20_000,
    schedulerMs: 60_000,
    retryBaseMs: 1_000,
    retryJitterMs: 250,
    retryMaxMs: 30_000,
    terminalRetention: 10,
} as const;

export function catalogConfig(env: NodeJS.ProcessEnv = process.env) {
    const integer = (
        key: string,
        fallback: number,
        min: number,
        max: number,
    ) => {
        const raw = env[key];
        if (raw === undefined) return fallback;
        const value = Number(raw);
        if (
            !/^\d+$/.test(raw) ||
            !Number.isSafeInteger(value) ||
            value < min ||
            value > max
        ) {
            throw new Error(`${key} must be an integer from ${min} to ${max}`);
        }
        return value;
    };
    const intervalDays = integer("IGDB_CATALOG_INTERVAL_DAYS", 7, 7, 14);
    if (intervalDays !== 7 && intervalDays !== 14) {
        throw new Error("IGDB_CATALOG_INTERVAL_DAYS must be 7 or 14");
    }
    return {
        intervalDays,
        batchSize: integer("IGDB_CATALOG_BATCH_SIZE", 25, 1, 500),
        gameConcurrency: integer("IGDB_CATALOG_GAME_CONCURRENCY", 1, 1, 2),
        relationConcurrency: integer(
            "IGDB_CATALOG_RELATION_CONCURRENCY",
            2,
            1,
            2,
        ),
        httpTimeoutMs: integer(
            "IGDB_CATALOG_HTTP_TIMEOUT_MS",
            30_000,
            1_000,
            60_000,
        ),
        maxResponseBytes: integer(
            "IGDB_CATALOG_MAX_RESPONSE_BYTES",
            16_777_216,
            1_048_576,
            67_108_864,
        ),
        maxAttempts: integer("IGDB_CATALOG_MAX_ATTEMPTS", 3, 1, 5),
    };
}

export type IgdbCatalogConfig = ReturnType<typeof catalogConfig>;
