import { PlayerLibrarySnapshot } from "../player-sync-attempt";
import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
import {
    XboxBatchMinutesPlayedResponse,
    XboxDisplayCatalogueLookupResponse,
    XboxGameAchievementsResponse,
    XboxGameTitle,
    XboxMinutesPlayedStatsItem,
    XboxMSStoreCatalogResponse,
} from "./xbox-sync.types";
import { XboxSyncAuthService } from "./auth/xbox-sync-auth.service";
import { ConnectionUserResolveDto } from "../../connection/dto/connection-user-resolve.dto";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import { getXboxPlayerXUID } from "./client/getXboxPlayerXUID";
import { callXboxAPI } from "./client/callXboxApi";
import { Cacheable } from "../../utils/cacheable";
import { ProviderSyncError } from "../provider-sync.error";
import { days, hours, minutes } from "@nestjs/throttler";

@Injectable()
export class XboxSyncService {
    private readonly GENERIC_XUID = "2535470385649416";
    private readonly logger = new Logger(XboxSyncService.name);

    constructor(
        private readonly authService: XboxSyncAuthService,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) {}

    public async resolveUserInfo(
        gamertag: string,
    ): Promise<ConnectionUserResolveDto> {
        const auth = await this.authService.getCatalogAuthCredentials();

        let playerXUID: string;
        try {
            playerXUID = await getXboxPlayerXUID(gamertag, auth);
        } catch (err) {
            this.logger.error(err);
            throw new HttpException(
                "Invalid gamertag or profile is set to private.",
                HttpStatus.BAD_REQUEST,
            );
        }

        return {
            username: gamertag,
            userId: playerXUID,
        };
    }

    /**
     * Returns a complete below-cap Xbox library; capped responses fail.
     * This method may take up to 20s to respond depending on the user's library size.
     * @param playerXUID
     */
    @PlayerLibrarySnapshot()
    @Cacheable(`${XboxSyncService.name}:complete-v1#getAllGames`, hours(1))
    public async getAllGames(playerXUID: string) {
        const auth = await this.authService.getUserAuthCredentials(playerXUID);

        const response: {
            xuid: string;
            titles: XboxGameTitle[];
            pagingInfo?: {
                continuationToken?: string;
                totalRecords?: number;
                totalItems?: number;
            };
            continuationToken?: string;
            totalRecords?: number;
            totalItemCount?: number;
            hasMore?: boolean;
            nextLink?: string;
        } = await callXboxAPI(
            {
                url: `https://titlehub.xboxlive.com/users/xuid(${playerXUID})/titles/titlehistory/decoration/productId`,
                params: {
                    maxItems: 5000,
                },
            },
            auth,
            2,
        );

        if (
            !Array.isArray(response?.titles) ||
            response.titles.length >= 5000 ||
            response.pagingInfo?.continuationToken ||
            response.continuationToken ||
            response.hasMore ||
            response.nextLink ||
            [
                response.pagingInfo?.totalRecords,
                response.pagingInfo?.totalItems,
                response.totalRecords,
                response.totalItemCount,
            ].some(
                (total) =>
                    total != null &&
                    (!Number.isSafeInteger(total) ||
                        total !== response.titles.length),
            )
        ) {
            // shortcut: TitleHub continuation is unverified, remove the cap rejection only after verifying its contract.
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete Xbox TitleHub library response",
            );
        }
        return response.titles;
    }

    @Cacheable(
        `${XboxSyncService.name}:complete-v1#getBatchMinutesPlayed`,
        hours(1),
    )
    public async getBatchMinutesPlayed(playerXUID: string, titleIds: string[]) {
        const items: XboxMinutesPlayedStatsItem[] = [];

        if (titleIds == undefined || titleIds.length === 0) {
            // Returns empty list
            return items;
        }

        const auth = await this.authService.getUserAuthCredentials(playerXUID);

        const MAX_REQUEST_SIZE = 1000;

        const statsRequestItems = titleIds.map((titleId) => ({
            name: "MinutesPlayed",
            titleId: titleId,
        }));

        for (
            let currentOffset = 0;
            currentOffset < statsRequestItems.length;
            currentOffset += MAX_REQUEST_SIZE
        ) {
            const slicedItems = statsRequestItems.slice(
                currentOffset,
                currentOffset + MAX_REQUEST_SIZE,
            );

            const statsBatch =
                await callXboxAPI<XboxBatchMinutesPlayedResponse>(
                    {
                        method: "POST",
                        url: `https://userstats.xboxlive.com/batch`,
                        data: {
                            arrangebyfield: "xuid",
                            xuids: [playerXUID],
                            stats: slicedItems,
                        },
                    },
                    auth,
                    2,
                );

            if (
                !Array.isArray(statsBatch?.statlistscollection) ||
                statsBatch.statlistscollection.some(
                    (collection) => !Array.isArray(collection?.stats),
                )
            ) {
                throw new ProviderSyncError(
                    "incomplete",
                    "Incomplete Xbox statistics response",
                );
            }

            items.push(
                ...statsBatch.statlistscollection.flatMap(
                    (collection) => collection.stats,
                ),
            );
        }

        return items;
    }

    @Cacheable(`${XboxSyncService.name}:complete-v1`, minutes(15))
    public async getObtainedAchievements(playerXUID: string, titleId: string) {
        const auth = await this.authService.getUserAuthCredentials(playerXUID);
        return this.fetchAchievements(auth, playerXUID, titleId);
    }

    /**
     * Returns all achievements available for a game.
     * A generic XUID is used, so don't expect 'owned' statistics to be accurate.
     * @param titleId
     */
    @Cacheable(`${XboxSyncService.name}:complete-v1`, hours(24))
    public async getAvailableAchievements(titleId: string) {
        const auth = await this.authService.getCatalogAuthCredentials();
        return this.fetchAchievements(auth, this.GENERIC_XUID, titleId);
    }

    private async fetchAchievements(
        auth: { XSTSToken: string; userHash: string },
        xuid: string,
        titleId: string,
    ) {
        const achievements: XboxGameAchievementsResponse["achievements"] = [];
        const seenTokens = new Set<string>();
        const seenAchievements = new Set<string>();
        let continuationToken: string | undefined;
        let expectedTotal: number | undefined;

        let pages = 0;
        do {
            if (++pages > 1000)
                throw new ProviderSyncError(
                    "incomplete",
                    "Xbox achievement page limit exceeded",
                );
            const result = await callXboxAPI<XboxGameAchievementsResponse>(
                {
                    url: `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements`,
                    params: {
                        titleId,
                        maxItems: 1000,
                        ...(continuationToken ? { continuationToken } : {}),
                    },
                },
                auth,
            );
            const total =
                result?.pagingInfo?.totalRecords ??
                result?.pagingInfo?.totalItems;
            const next = result?.pagingInfo?.continuationToken;
            if (
                !Array.isArray(result?.achievements) ||
                (total != null &&
                    (!Number.isSafeInteger(total) || total < 0)) ||
                (expectedTotal != null &&
                    total != null &&
                    expectedTotal !== total) ||
                (next !== null && typeof next !== "string")
            )
                throw new ProviderSyncError(
                    "incomplete",
                    "Incomplete Xbox achievement response",
                );
            expectedTotal = total ?? expectedTotal;
            for (const achievement of result.achievements) {
                if (!achievement?.id || !achievement.serviceConfigId)
                    throw new ProviderSyncError(
                        "incomplete",
                        "Invalid Xbox achievement identity",
                    );
                const identity = `${achievement.serviceConfigId}:${achievement.id}`;
                if (seenAchievements.has(identity))
                    throw new ProviderSyncError(
                        "incomplete",
                        "Repeated Xbox achievement identity",
                    );
                seenAchievements.add(identity);
            }
            achievements.push(...result.achievements);
            if (
                expectedTotal != null &&
                (achievements.length > expectedTotal ||
                    (!next && achievements.length !== expectedTotal))
            )
                throw new ProviderSyncError(
                    "incomplete",
                    "Incomplete Xbox achievement total",
                );
            if (
                next &&
                (seenTokens.has(next) ||
                    result.achievements.length === 0 ||
                    achievements.length === expectedTotal)
            )
                throw new ProviderSyncError(
                    "incomplete",
                    "Xbox achievement continuation made no progress",
                );
            if (next) seenTokens.add(next);
            continuationToken = next || undefined;
        } while (continuationToken);

        return achievements;
    }

    @Cacheable(`${XboxSyncService.name}:complete-v1`, days(7))
    public async getTitleIdByPFN(pfn: string) {
        const response = await callXboxAPI<XboxDisplayCatalogueLookupResponse>(
            {
                url: "https://displaycatalog.mp.microsoft.com/v7.0/products/lookup",
                headers: {
                    Authorization: null,
                },
                params: {
                    top: 25,
                    alternateId: "PackageFamilyName",
                    fieldsTemplate: "details",
                    languages: "en-US",
                    market: "us",
                    value: pfn,
                },
            },
            // API doesn't demand auth
            { userHash: "", XSTSToken: "" },
        );

        if (response != undefined && response.Products?.length > 0) {
            const alternativeIds = response.Products[0].AlternateIds;

            const titleId = alternativeIds.find(
                (alt) => alt.IdType === "XboxTitleId",
            );

            if (titleId) {
                return titleId.Value;
            }
        }

        throw new HttpException(
            "No titleId match found for PFN: " + pfn,
            HttpStatus.BAD_REQUEST,
        );
    }

    @Cacheable(`${XboxSyncService.name}:complete-v1`, days(7))
    public async getPFNByProductId(productId: string) {
        const response = await callXboxAPI<XboxMSStoreCatalogResponse>(
            {
                method: "POST",
                url: "https://storeedgefd.dsx.mp.microsoft.com/v8.0/sdk/products?market=US&locale=en-US&deviceFamily=Windows.Xbox",
                data: { productIds: productId },
                headers: {
                    Authorization: null,
                },
            },
            // API doesn't demand auth
            { userHash: "", XSTSToken: "" },
        );

        if (response != undefined && response.Products?.length > 0) {
            if (response.Products[0].Properties?.PackageFamilyName) {
                return response.Products[0].Properties?.PackageFamilyName;
            }
        }

        throw new HttpException(
            "No PFN match found for productId: " + productId,
            HttpStatus.BAD_REQUEST,
        );
    }
}
