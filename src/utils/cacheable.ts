import { Cache } from "@nestjs/cache-manager";
import { minutes } from "@nestjs/throttler";

let cacheManager: Cache | null = null;

export function setCacheManager(cache: Cache) {
    cacheManager = cache;
}

/**
 * A custom decorator that automatically applies caching logic to any valid method
 *
 * @param cacheKeyPrefix - cacheKeyPrefix helps further differentiate methods with similar names. This is usually
 * the class's name.
 * @param ttl - cache time to live in milliseconds
 * @param cacheNullable - if nullable values should be cached too
 * @example
 * ```typescript
 * @Cacheable(SteamSyncService.name, hours(1))
 * public async getAllGames(
 *    steamUserId: string,
 * ): Promise<any> {
 * // Example generated cache key: "SteamSyncService#getAllGames__['76561198136665859']"
 */
export function Cacheable(
    cacheKeyPrefix: string,
    ttl: number = minutes(1),
    cacheNullable = false,
) {
    return function (
        target: any,
        propertyName: string,
        descriptor: PropertyDescriptor,
    ) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args: any[]) {
            const finalCacheKey = `${cacheKeyPrefix}#${originalMethod.name}__${JSON.stringify(args)}`;

            if (cacheManager == undefined) {
                console.error(
                    `@Cacheable applied to method without cacheManager defined: ${finalCacheKey}.`,
                );
                console.error(
                    "Make sure to call setCacheManager at startup with a valid cache manager instance before using @Cacheable.",
                );
                return originalMethod.apply(this, args);
            }

            // Try to get cached data
            try {
                const cachedResult = await cacheManager.get(finalCacheKey);
                if (cachedResult) {
                    return cachedResult;
                }
            } catch (error) {
                console.error(
                    `Cache get error for key: ${finalCacheKey}:`,
                    error,
                );
            }

            // Call the original method if cache miss
            const result = await originalMethod.apply(this, args);

            // Set the new result in cache
            if (result != null || cacheNullable) {
                cacheManager.set(finalCacheKey, result, ttl).catch((err) => {
                    console.error(
                        `Cache set error for key: ${finalCacheKey}:`,
                        err,
                    );
                });
            }

            return result;
        };

        return descriptor;
    };
}
