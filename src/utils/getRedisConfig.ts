import * as process from "process";

/**
 * Should only be called after 'ConfigModule' is loaded (e.g. in useFactory)
 */
export function getRedisConfig(target: "cache" | "bullmq" = "cache") {
    /**
     * While the "redis" property below accepts a string, and it works fine on local,
     * it fails on Docker, so use host and port instead.
     */
    let redisUrl = process.env.REDIS_URL;
    if (target === "bullmq") {
        redisUrl = process.env.BULLMQ_REDIS_URL;
    }
    const redisHost = new URL(redisUrl!).hostname;
    const redisPort = new URL(redisUrl!).port;

    return {
        url: redisUrl,
        host: redisHost,
        port: parseInt(redisPort, 10),
    } as const;
}
