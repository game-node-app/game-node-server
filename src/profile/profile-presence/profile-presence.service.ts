import { Inject, Injectable } from "@nestjs/common";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import { UserSummary } from "steamapi";
import { BillingService } from "../../billing/billing.service";
import { EConnectionType } from "../../connection/connections.constants";
import { ConnectionsService } from "../../connection/connections.service";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";
import { ExternalGameService } from "../../game/external-game/external-game.service";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { profilePresenceCacheKey } from "../supporter-preferences/supporter-preferences.cache";
import { SupporterPreferencesService } from "../supporter-preferences/supporter-preferences.service";
import { ProfilePresenceResponseDto } from "./dto/profile-presence.dto";

const PROFILE_PRESENCE_CACHE_TTL_MS = 60_000;
const NO_PRESENCE: ProfilePresenceResponseDto = { playing: null };

@Injectable()
export class ProfilePresenceService {
    /**
     * Shares one in-flight resolution between viewers, so a cold miss calls Steam once.
     * shortcut: per-process dedupe; a multi-instance deployment can call Steam once
     * per instance per window. Add a Redis lock if the app scales horizontally.
     */
    private readonly inFlight = new Map<
        string,
        Promise<ProfilePresenceResponseDto>
    >();

    constructor(
        private readonly billingService: BillingService,
        private readonly supporterPreferencesService: SupporterPreferencesService,
        private readonly connectionsService: ConnectionsService,
        private readonly steamSyncService: SteamSyncService,
        private readonly externalGameService: ExternalGameService,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
    ) {}

    /** Design 6: read through a per-user cache so Steam is called at most once per window. */
    async getPresence(userId: string): Promise<ProfilePresenceResponseDto> {
        const cacheKey = profilePresenceCacheKey(userId);
        const cached = await this.cache
            .get<ProfilePresenceResponseDto>(cacheKey)
            .catch(() => undefined);
        if (cached != null) return cached;

        const running = this.inFlight.get(userId);
        if (running) return running;

        const pending = this.resolvePresence(userId)
            .then(async (presence) => {
                await this.cache
                    .set(
                        cacheKey,
                        presence,
                        PROFILE_PRESENCE_CACHE_TTL_MS,
                    )
                    .catch(() => undefined);
                return presence;
            })
            .finally(() => this.inFlight.delete(userId));
        this.inFlight.set(userId, pending);
        return pending;
    }

    private async resolvePresence(
        userId: string,
    ): Promise<ProfilePresenceResponseDto> {
        if (!(await this.billingService.isSupporter(userId))) {
            return NO_PRESENCE;
        }

        const preferences =
            await this.supporterPreferencesService.findOrDefaults(userId);
        if (!preferences.showLiveProfile) return NO_PRESENCE;

        const connection = await this.connectionsService.findOneByUserIdAndType(
            userId,
            EConnectionType.STEAM,
        );
        if (!connection) return NO_PRESENCE;

        let summary: UserSummary;
        try {
            summary = await this.steamSyncService.getUserSummary(
                connection.sourceUserId,
            );
        } catch {
            return NO_PRESENCE;
        }
        // Steam omits both fields when not in a game or when details are private.
        if (summary?.gameID == null || !summary.gameName) return NO_PRESENCE;

        const [mapped] =
            await this.externalGameService.getExternalGamesForSourceIds(
                [String(summary.gameID)],
                EGameExternalGameCategory.Steam,
            );

        return {
            playing: {
                source: "steam",
                name: summary.gameName,
                gameId: mapped?.gameId ?? null,
            },
        };
    }
}
