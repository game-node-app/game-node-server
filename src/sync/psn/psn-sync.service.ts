import { HttpException, Injectable, Logger } from "@nestjs/common";
import { PsnSyncAuthService } from "./auth/psn-sync-auth.service";
import { Cache } from "@nestjs/cache-manager";
import {
    makeUniversalSearch,
    getUserPlayedGames,
    UniversalSearchResponse,
    SocialAccountResult,
    UserPlayedGamesResponse,
} from "psn-api";
import { HttpStatusCode } from "axios";
import { ConnectionUserResolveDto } from "../../connections/dto/connection-user-resolve.dto";
import { hours, minutes } from "@nestjs/throttler";
import { Cacheable } from "../../utils/cacheable";

@Injectable()
export class PsnSyncService {
    private readonly logger = new Logger(PsnSyncService.name);

    constructor(private readonly authService: PsnSyncAuthService) {
        // this.getGames("5847504196784127951", 0, 1);
        // this.getAllGames("5847504196784127951");
    }

    public async resolveUserInfo(
        userIdentifier: string,
    ): Promise<ConnectionUserResolveDto> {
        const authorization = await this.authService.getValidAccessToken();

        let allAccountsSearchResults: UniversalSearchResponse<SocialAccountResult>;
        try {
            // Get the user's `accountId` from the username.
            allAccountsSearchResults = await makeUniversalSearch(
                authorization,
                userIdentifier,
                "SocialAllAccounts",
            );
        } catch (err) {
            this.logger.error(err);
            throw new HttpException(
                "Failed to fetch user info. PSN may be unavailable or user profile is set to private.",
                HttpStatusCode.BadRequest,
            );
        }

        if (
            allAccountsSearchResults.domainResponses == undefined ||
            allAccountsSearchResults.domainResponses.length === 0 ||
            allAccountsSearchResults.domainResponses[0].results == undefined ||
            allAccountsSearchResults.domainResponses[0].results.length === 0
        ) {
            throw new HttpException(
                "User not found or profile is set to private.",
                HttpStatusCode.BadRequest,
            );
        }

        const targetAccount =
            allAccountsSearchResults.domainResponses[0].results[0]
                .socialMetadata;

        return {
            userId: targetAccount.accountId,
            username: targetAccount.onlineId,
        };
    }

    /**
     * Gets a list of user games.
     * @param accountId
     * @param offset
     * @param limit - max of 200 allowed by PSN api
     */
    @Cacheable(PsnSyncService.name, minutes(15))
    public async getGames(accountId: string, offset = 0, limit = 20) {
        const authorization = await this.authService.getValidAccessToken();

        try {
            const response = await getUserPlayedGames(
                authorization,
                accountId,
                {
                    offset,
                    limit,
                },
            );

            return response;
        } catch (err: unknown) {
            this.logger.error(err);
            throw new HttpException(
                "Failed to fetch user's games. PSN may be unavailable or user profile is set to private.",
                HttpStatusCode.BadRequest,
            );
        }
    }

    /**
     * A shorthand that repeatedly calls 'getGames' until the user's library is exhausted.
     * @param accountId
     * @returns a list of games - may be empty if no game was found for the given accountId
     * may also be incomplete if any of the fetches failed.
     */
    @Cacheable(PsnSyncService.name, hours(1))
    public async getAllGames(
        accountId: string,
    ): Promise<UserPlayedGamesResponse["titles"]> {
        const totalTitles: UserPlayedGamesResponse["titles"] = [];

        // Max allowed
        const LIMIT_PER_PAGE = 50;
        let currentOffset = 0;

        while (true) {
            try {
                const response = await this.getGames(
                    accountId,
                    currentOffset,
                    LIMIT_PER_PAGE,
                );

                if (
                    response != undefined &&
                    response.titles != undefined &&
                    Array.isArray(response.titles)
                ) {
                    totalTitles.push(...response.titles);
                    if (response.totalItemCount > totalTitles.length) {
                        currentOffset += LIMIT_PER_PAGE;
                        continue;
                    }
                }
            } catch (err: unknown) {
                this.logger.error(err);
            }

            // Break by default
            break;
        }

        return totalTitles;
    }
}
