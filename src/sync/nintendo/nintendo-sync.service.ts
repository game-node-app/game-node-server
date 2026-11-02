import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import {
    cancellableProviderCall,
    PlayerLibrarySnapshot,
} from "../player-sync-attempt";
import { ProviderSyncError } from "../provider-sync.error";
import { NintendoSyncAuthService } from "./auth/nintendo-sync-auth.service";
import {
    NINTENDO_LOCALE,
    NINTENDO_PLAY_HISTORY_URL,
    NINTENDO_USER_AGENT,
} from "./nintendo-account";
import { NintendoPlatform, NintendoPlayEntry } from "./nintendo-sync.types";

const TITLE_ID_PATTERN = /^[0-9a-f]{16}$/i;
const SUPPORTED_PLATFORMS: string[] = ["HAC", "BEE"];

const toDate = (value: unknown) => {
    const date = typeof value === "string" ? new Date(value) : undefined;
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
};

@Injectable()
export class NintendoSyncService {
    private readonly logger = new Logger(NintendoSyncService.name);

    constructor(private readonly authService: NintendoSyncAuthService) {}

    /** Visible Switch and Switch 2 entries of the account; an empty history is a valid result. */
    @PlayerLibrarySnapshot()
    public async getPlayHistory(
        accountId: string,
    ): Promise<NintendoPlayEntry[]> {
        const accessToken = await this.authService.getAccessToken(accountId);
        const data = await cancellableProviderCall(
            `nintendo:user:${accountId}`,
            async (signal) =>
                (
                    await axios.get(NINTENDO_PLAY_HISTORY_URL, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            Accept: "application/json",
                            "gentry-locale": NINTENDO_LOCALE,
                            "User-Agent": NINTENDO_USER_AGENT,
                        },
                        timeout: 30_000,
                        signal,
                    })
                ).data,
        );

        const raw = data?.playHistories;
        if (!Array.isArray(raw)) {
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete Nintendo play history response",
            );
        }
        // shortcut: hidden-list elements are matched as a string or { titleId }, because only an empty list has been seen; adjust once a hidden title has been observed.
        const hidden = new Set(
            (Array.isArray(data.hiddenTitleList)
                ? data.hiddenTitleList
                : []
            ).map((item: any) =>
                String(
                    typeof item === "string" ? item : item?.titleId,
                ).toUpperCase(),
            ),
        );

        const entries: NintendoPlayEntry[] = [];
        const skipped = new Map<string, number>();
        for (const item of raw) {
            const platform = item?.platform ?? item?.deviceType;
            if (
                !TITLE_ID_PATTERN.test(item?.titleId) ||
                typeof platform !== "string" ||
                !Number.isFinite(item?.totalPlayedMinutes)
            ) {
                // One bad entry fails the sync: a shape change affects every entry, and a partial import would hide it.
                this.logger.error(
                    `Nintendo play history entry has an unexpected shape, fields: ${Object.keys(item ?? {}).join(",")}`,
                );
                throw new ProviderSyncError(
                    "incomplete",
                    "Incomplete Nintendo play history entry",
                );
            }
            if (!SUPPORTED_PLATFORMS.includes(platform)) {
                skipped.set(platform, (skipped.get(platform) ?? 0) + 1);
                continue;
            }
            const titleId = item.titleId.toUpperCase();
            if (hidden.has(titleId)) continue;
            entries.push({
                titleId,
                titleName:
                    typeof item.titleName === "string"
                        ? item.titleName
                        : undefined,
                platform: platform as NintendoPlatform,
                minutes: item.totalPlayedMinutes,
                firstPlayedAt: toDate(item.firstPlayedAt),
                lastPlayedAt: toDate(item.lastPlayedAt),
            });
        }
        if (skipped.size > 0) {
            this.logger.log(
                `Skipped Nintendo platforms: ${JSON.stringify(Object.fromEntries(skipped))}`,
            );
        }
        return entries;
    }
}
