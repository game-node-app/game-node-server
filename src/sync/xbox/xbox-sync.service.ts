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
import { ConnectionUserResolveDto } from "../../connections/dto/connection-user-resolve.dto";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import { getXboxPlayerXUID } from "./client/getXboxPlayerXUID";
import { callXboxAPI } from "./client/callXboxApi";
import { Cacheable } from "../../utils/cacheable";
import { days, hours, minutes } from "@nestjs/throttler";

@Injectable()
export class XboxSyncService {
    private readonly GENERIC_XUID = "2535470385649416";
    private readonly logger = new Logger(XboxSyncService.name);

    constructor(
        private readonly authService: XboxSyncAuthService,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) {
        // (async () => {
        //     const pfn = await this.getPFNByProductId("BTNPS60N3114");
        //     const titleId = await this.getTitleIdByPFN(pfn);
        //     const achievements = await this.getAvailableAchievements(titleId);
        //
        //     return achievements;
        // })();
    }

    public async resolveUserInfo(
        gamertag: string,
    ): Promise<ConnectionUserResolveDto> {
        const auth = await this.authService.getAuthCredentials();

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
     * Returns the entire user's Xbox library, up to X items.
     * This method may take up to 20s to respond depending on the user's library size.
     * @param playerXUID
     */
    @Cacheable(`${XboxSyncService.name}#getAllGames`, hours(1))
    public async getAllGames(playerXUID: string) {
        const auth = await this.authService.getAuthCredentials();

        try {
            const response: {
                xuid: string;
                titles: XboxGameTitle[];
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

            return response.titles;
        } catch (err) {
            this.logger.error(err);
            throw new HttpException(
                "Failed to fetch games. User's library may be set to private.",
                HttpStatus.BAD_REQUEST,
            );
        }
    }

    @Cacheable(`${XboxSyncService.name}#getBatchMinutesPlayed`, hours(1))
    public async getBatchMinutesPlayed(playerXUID: string, titleIds: string[]) {
        const items: XboxMinutesPlayedStatsItem[] = [];

        if (titleIds == undefined || titleIds.length === 0) {
            // Returns empty list
            return items;
        }

        const auth = await this.authService.getAuthCredentials();

        const MAX_REQUEST_SIZE = 1000;
        let currentOffset = 0;

        const statsRequestItems = titleIds.map((titleId) => ({
            name: "MinutesPlayed",
            titleId: titleId,
        }));

        while (currentOffset < statsRequestItems.length) {
            try {
                const slicedItems = statsRequestItems.slice(
                    currentOffset,
                    currentOffset + MAX_REQUEST_SIZE + 1,
                );

                if (slicedItems.length === 0) {
                    break;
                }

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
                    statsBatch.statlistscollection == undefined ||
                    statsBatch.statlistscollection.length === 0 ||
                    statsBatch.statlistscollection[0].stats.length === 0
                ) {
                    continue;
                }

                const resultingStats = statsBatch.statlistscollection[0].stats;

                items.push(...resultingStats);

                currentOffset += MAX_REQUEST_SIZE;
            } catch (err) {
                this.logger.error(err);
                break;
            }
        }

        return items;
    }

    @Cacheable(XboxSyncService.name, minutes(15))
    public async getObtainedAchievements(playerXUID: string, titleId: string) {
        const auth = await this.authService.getAuthCredentials();

        const result = await callXboxAPI<XboxGameAchievementsResponse>(
            {
                url: `https://achievements.xboxlive.com/users/xuid(${playerXUID})/achievements`,
                params: {
                    titleId,
                    maxItems: 1000,
                },
            },
            auth,
        );

        return result.achievements;
    }

    /**
     * Returns all achievements available for a game.
     * A generic XUID is used, so don't expect 'owned' statistics to be accurate.
     * @param titleId
     */
    @Cacheable(XboxSyncService.name, hours(24))
    public async getAvailableAchievements(titleId: string) {
        return this.getObtainedAchievements(this.GENERIC_XUID, titleId);
    }

    @Cacheable(XboxSyncService.name, days(7))
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

    @Cacheable(XboxSyncService.name, days(7))
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
