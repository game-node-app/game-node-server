/** Explicit fixture settings only. Never load dotenv or application configuration. */
export function testEnvironment(env: NodeJS.ProcessEnv = {}) {
    const mysqlHost = env.IGDB_TEST_MYSQL_HOST ?? "127.0.0.1";
    const redisHost = env.IGDB_TEST_REDIS_HOST ?? "127.0.0.1";
    for (const host of [mysqlHost, redisHost]) {
        if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
            throw new Error("IGDB tests require a loopback MySQL/Redis host");
        }
    }
    const database = env.IGDB_TEST_MYSQL_DATABASE ?? "igdb_sync_test";
    if (database !== "igdb_sync_test") {
        throw new Error("IGDB tests require database igdb_sync_test");
    }
    const prefix = env.IGDB_TEST_QUEUE_PREFIX ?? "igdb-test-catalog";
    if (!prefix.startsWith("igdb-test-")) {
        throw new Error("IGDB tests require an igdb-test- queue prefix");
    }
    const port = (value: string | undefined, fallback: number) => {
        if (value === undefined) return fallback;
        if (!/^\d+$/.test(value) || +value < 1 || +value > 65535) {
            throw new Error("IGDB test ports must be integers from 1 to 65535");
        }
        return +value;
    };
    return {
        mysql: {
            type: "mysql" as const,
            bigNumberStrings: false,
            host: mysqlHost,
            port: port(env.IGDB_TEST_MYSQL_PORT, 13306),
            username: "igdb_test",
            password: "igdb-test-password",
            database,
        },
        redis: { host: redisHost, port: port(env.IGDB_TEST_REDIS_PORT, 16379) },
        prefix,
    };
}
