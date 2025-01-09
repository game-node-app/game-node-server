import { Cache } from "cache-manager";
import { minutes } from "@nestjs/throttler";

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

            const cache: Cache = this.cacheManager;

            if (!cache) {
                throw new Error(
                    "Cannot use Cacheable() decorator without injecting the cache manager.",
                );
            }

            // Try to get cached data
            try {
                const cachedResult = await cache.get(finalCacheKey);
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
            if (result != undefined || cacheNullable) {
                cache.set(finalCacheKey, result, ttl).catch((err) => {
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
