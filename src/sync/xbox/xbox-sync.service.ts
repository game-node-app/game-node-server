import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
import {
    XboxBatchMinutesPlayedResponse,
    XboxGameTitle,
    XboxMinutesPlayedStatsItem,
} from "./xbox-sync.types";
import { XboxSyncAuthService } from "./auth/xbox-sync-auth.service";
import { ConnectionUserResolveDto } from "../../connections/dto/connection-user-resolve.dto";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import { getXboxPlayerXUID } from "./client/getXboxPlayerXUID";
import { callXboxAPI } from "./client/callXboxApi";
import { Cacheable } from "../../utils/cacheable";
import { hours } from "@nestjs/throttler";

@Injectable()
export class XboxSyncService {
    private readonly logger = new Logger(XboxSyncService.name);

    constructor(
        private readonly authService: XboxSyncAuthService,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) {}

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

                // Request
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
}
