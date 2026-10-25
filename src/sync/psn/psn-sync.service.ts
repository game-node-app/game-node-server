import { PlayerLibrarySnapshot } from "../player-sync-attempt";
import { HttpException, Injectable, Logger } from "@nestjs/common";
import { PsnSyncAuthService } from "./auth/psn-sync-auth.service";
import {
    getTitleTrophies,
    getTitleTrophyGroups,
    getUserPlayedGames,
    getUserTitles,
    getUserTrophiesEarnedForTitle,
    makeUniversalSearch,
    SocialAccountResult,
    UniversalSearchResponse,
    UserPlayedGamesResponse,
    UserTitlesResponse,
} from "psn-api";
import { HttpStatusCode } from "axios";
import { ConnectionUserResolveDto } from "../../connection/dto/connection-user-resolve.dto";
import { hours, minutes } from "@nestjs/throttler";
import { Cacheable } from "../../utils/cacheable";
import { uncancellableProviderCall } from "../player-sync-attempt";
import { ProviderSyncError } from "../provider-sync.error";

@Injectable()
export class PsnSyncService {
    private readonly logger = new Logger(PsnSyncService.name);

    constructor(private readonly authService: PsnSyncAuthService) {}

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
    @Cacheable(`${PsnSyncService.name}:complete-v1`, minutes(15))
    public async getGames(accountId: string, offset = 0, limit = 20) {
        const authorization = await this.authService.getValidAccessToken();

        const response = await uncancellableProviderCall("PSN", () =>
            getUserPlayedGames(authorization, accountId, { offset, limit }),
        );
        if (
            !Array.isArray(response?.titles) ||
            "error" in response ||
            !Number.isSafeInteger(response.totalItemCount) ||
            response.totalItemCount < 0
        )
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete PSN played-game response",
            );
        return response;
    }

    /**
     * A shorthand that repeatedly calls 'getGames' until the user's library is exhausted.
     * @param accountId
     * @returns a list of games - may be empty if no game was found for the given accountId
     * Rejects incomplete or non-progressing pagination.
     */
    @PlayerLibrarySnapshot()
    @Cacheable(`${PsnSyncService.name}:complete-v1`, hours(1))
    public async getAllGames(
        accountId: string,
    ): Promise<UserPlayedGamesResponse["titles"]> {
        const totalTitles: UserPlayedGamesResponse["titles"] = [];

        const LIMIT_PER_PAGE = 50;
        let currentOffset = 0;
        let expectedTotal: number | undefined;
        const seen = new Set<string>();

        while (true) {
            const response = await this.getGames(
                accountId,
                currentOffset,
                LIMIT_PER_PAGE,
            );
            if (
                !Array.isArray(response?.titles) ||
                !Number.isSafeInteger(response.totalItemCount) ||
                response.totalItemCount < 0 ||
                (expectedTotal != null &&
                    expectedTotal !== response.totalItemCount)
            ) {
                throw new ProviderSyncError(
                    "incomplete",
                    "Incomplete PSN played-game response",
                );
            }
            expectedTotal = response.totalItemCount;
            for (const title of response.titles) {
                if (!title?.titleId || seen.has(title.titleId)) {
                    throw new ProviderSyncError(
                        "incomplete",
                        "Repeated or invalid PSN played-game identity",
                    );
                }
                seen.add(title.titleId);
            }
            totalTitles.push(...response.titles);
            const nextOffset = currentOffset + response.titles.length;
            if (nextOffset > expectedTotal)
                throw new ProviderSyncError(
                    "incomplete",
                    "Invalid PSN played-game total",
                );
            if (
                response.nextOffset != null &&
                response.nextOffset !== nextOffset
            ) {
                throw new ProviderSyncError(
                    "incomplete",
                    "Invalid PSN played-game continuation",
                );
            }
            if (nextOffset === expectedTotal) break;
            if (nextOffset === currentOffset)
                throw new ProviderSyncError(
                    "incomplete",
                    "PSN played-game pagination made no progress",
                );
            currentOffset = nextOffset;
        }

        return totalTitles;
    }

    @Cacheable(`${PsnSyncService.name}:complete-v1`, hours(24))
    public async getGameAchievements(
        npCommunicationId: string,
        npServiceName: string,
    ) {
        const authorization = await this.authService.getValidAccessToken();

        return this.getAllTrophies((offset, limit) =>
            getTitleTrophies(authorization, npCommunicationId, "all", {
                npServiceName: npServiceName as never,
                offset,
                limit,
            }),
        );
    }

    @Cacheable(`${PsnSyncService.name}:complete-v1`, hours(24))
    public async getGameAchievementGroups(
        npCommunicationId: string,
        npServiceName: string,
    ) {
        const authorization = await this.authService.getValidAccessToken();

        const response = await uncancellableProviderCall("PSN", () =>
            getTitleTrophyGroups(authorization, npCommunicationId, {
                npServiceName: npServiceName as never,
            }),
        );

        if (
            response == null ||
            "error" in response ||
            !Array.isArray(response.trophyGroups)
        ) {
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete PSN trophy-group response",
            );
        }

        return response;
    }

    @Cacheable(`${PsnSyncService.name}:complete-v1`, minutes(15))
    public async getObtainedAchievements(
        accountId: string,
        npCommunicationId: string,
        npServiceName: string,
    ) {
        const authorization = await this.authService.getValidAccessToken();

        return this.getAllTrophies((offset, limit) =>
            getUserTrophiesEarnedForTitle(
                authorization,
                accountId,
                npCommunicationId,
                "all",
                { npServiceName: npServiceName as never, offset, limit },
            ),
        );
    }

    private async getAllTrophies<T extends { trophyId: number }>(
        fetchPage: (
            offset: number,
            limit: number,
        ) => Promise<{
            trophies: T[];
            totalItemCount: number;
            nextOffset?: number;
        }>,
    ): Promise<T[]> {
        const trophies: T[] = [];
        const seen = new Set<number>();
        let offset = 0;
        let expectedTotal: number | undefined;
        while (true) {
            const response = await uncancellableProviderCall("PSN", () =>
                fetchPage(offset, 100),
            );
            if (
                !Array.isArray(response?.trophies) ||
                "error" in response ||
                !Number.isSafeInteger(response.totalItemCount) ||
                response.totalItemCount < 0 ||
                (expectedTotal != null &&
                    expectedTotal !== response.totalItemCount)
            )
                throw new ProviderSyncError(
                    "incomplete",
                    "Incomplete PSN trophy-detail response",
                );
            expectedTotal = response.totalItemCount;
            for (const trophy of response.trophies) {
                if (
                    !Number.isSafeInteger(trophy?.trophyId) ||
                    trophy.trophyId < 0 ||
                    seen.has(trophy.trophyId)
                )
                    throw new ProviderSyncError(
                        "incomplete",
                        "Repeated or invalid PSN trophy identity",
                    );
                seen.add(trophy.trophyId);
            }
            trophies.push(...response.trophies);
            const nextOffset = offset + response.trophies.length;
            if (
                nextOffset > expectedTotal ||
                (response.nextOffset != null &&
                    response.nextOffset !== nextOffset)
            )
                throw new ProviderSyncError(
                    "incomplete",
                    "Invalid PSN trophy-detail continuation",
                );
            if (nextOffset === expectedTotal) return trophies;
            if (nextOffset === offset)
                throw new ProviderSyncError(
                    "incomplete",
                    "PSN trophy-detail pagination made no progress",
                );
            offset = nextOffset;
        }
    }

    /**
     * An alternative version of 'getUserGames' that returns trophy related information.
     * The {@link GameExternalGame#uid} is not available in this endpoint, so associations may be imprecise.
     * @param accountId
     */
    @Cacheable(`${PsnSyncService.name}:complete-v1`, hours(1))
    public async getUserTrophyTitles(accountId: string) {
        const authorization = await this.authService.getValidAccessToken();

        const MAX_PER_PAGE = 800;
        let currentOffset = 0;

        const titles: UserTitlesResponse["trophyTitles"] = [];

        let expectedTotal: number | undefined;
        const seen = new Set<string>();

        while (true) {
            const response = await uncancellableProviderCall("PSN", () =>
                getUserTitles(authorization, accountId, {
                    offset: currentOffset,
                    limit: MAX_PER_PAGE,
                }),
            );
            if (
                !Array.isArray(response?.trophyTitles) ||
                "error" in response ||
                !Number.isSafeInteger(response.totalItemCount) ||
                response.totalItemCount < 0 ||
                (expectedTotal != null &&
                    expectedTotal !== response.totalItemCount)
            ) {
                throw new ProviderSyncError(
                    "incomplete",
                    "Incomplete PSN trophy-title response",
                );
            }
            expectedTotal = response.totalItemCount;
            for (const title of response.trophyTitles) {
                if (!title?.npCommunicationId || !title.npServiceName) {
                    throw new ProviderSyncError(
                        "incomplete",
                        "Invalid PSN trophy-title identity",
                    );
                }
                const identity = `${title.npCommunicationId}:${title.npServiceName}`;
                if (seen.has(identity))
                    throw new ProviderSyncError(
                        "incomplete",
                        "Repeated PSN trophy-title identity",
                    );
                seen.add(identity);
            }
            titles.push(...response.trophyTitles);
            const nextOffset = currentOffset + response.trophyTitles.length;
            if (nextOffset > expectedTotal)
                throw new ProviderSyncError(
                    "incomplete",
                    "Invalid PSN trophy-title total",
                );
            if (
                response.nextOffset != null &&
                response.nextOffset !== nextOffset
            ) {
                throw new ProviderSyncError(
                    "incomplete",
                    "Invalid PSN trophy-title continuation",
                );
            }
            if (nextOffset === expectedTotal) break;
            if (nextOffset === currentOffset)
                throw new ProviderSyncError(
                    "incomplete",
                    "PSN trophy-title pagination made no progress",
                );
            currentOffset = nextOffset;
        }

        return titles;
    }
}
