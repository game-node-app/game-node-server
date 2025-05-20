import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
import { XboxGameTitle, XboxMinutesPlayedStatsItem } from "./xbox-sync.types";
import { XboxSyncAuthService } from "./auth/xbox-sync-auth.service";
import { ConnectionUserResolveDto } from "../../connections/dto/connection-user-resolve.dto";
import { Cacheable } from "../../utils/cacheable";
import { hours } from "@nestjs/throttler";
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";
import { getXboxPlayerXUID } from "./client/getXboxPlayerXUID";
import { callXboxAPI } from "./client/callXboxApi";

@Injectable()
export class XboxSyncService {
    private readonly logger = new Logger(XboxSyncService.name);

    constructor(
        private readonly authService: XboxSyncAuthService,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) {
        // this.resolveUserInfo("smrnov");
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
    public async getBatchMinutesPlayed(playerXUID: string, titleIds: number[]) {
        const items: XboxMinutesPlayedStatsItem[] = [];
        const MAX_REQUEST_SIZE = 500;
        let currentOffset = 0;

        if (titleIds == undefined || titleIds.length === 0) {
            // Returns empty list
            return items;
        }
    }

    // public async test() {
    //     const playerXUID = await getPlayerXUID("darkling1542", {
    //         XSTSToken: auth.xsts_token,
    //         userHash: auth.user_hash,
    //     });
    //
    //     const playerSettings = await getPlayerSettings(
    //         "smrnov",
    //         {
    //             XSTSToken: auth.xsts_token,
    //             userHash: auth.user_hash,
    //         },
    //         ["Gamertag", "ModernGamertag"],
    //     );
    //
    //     const resp: {
    //         titles: XboxGameTitle[];
    //     } = await call(
    //         {
    //             url: `https://titlehub.xboxlive.com/users/xuid(${playerXUID})/titles/titlehistory/decoration/productId`,
    //             params: {
    //                 maxItems: 5000,
    //             },
    //         },
    //         {
    //             XSTSToken: auth.xsts_token,
    //             userHash: auth.user_hash,
    //         },
    //         2,
    //     );
    //
    //     const titleIds = resp.titles.map((title) => title.titleId);
    //
    //     const statsRequest = titleIds
    //         .map((titleId) => ({
    //             name: "MinutesPlayed",
    //             titleId: titleId,
    //         }))
    //         .slice(0, 501);
    //
    //     // @see https://github.com/OpenXbox/xbox-webapi-python/blob/master/xbox/webapi/api/provider/userstats/__init__.py
    //     // MAX OF 500 ITEMS PER REQUEST!!
    //     const statsBatch = await call(
    //         {
    //             method: "POST",
    //             url: `https://userstats.xboxlive.com/batch`,
    //             data: {
    //                 arrangebyfield: "xuid",
    //                 xuids: [playerXUID],
    //                 stats: statsRequest,
    //             },
    //         },
    //         {
    //             XSTSToken: auth.xsts_token,
    //             userHash: auth.user_hash,
    //         },
    //         2,
    //     );
    //
    //     return statsBatch;
    // }
}
