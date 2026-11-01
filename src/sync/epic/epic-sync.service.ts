import { Injectable } from "@nestjs/common";
import axios from "axios";
import {
    cancellableProviderCall,
    PlayerLibrarySnapshot,
} from "../player-sync-attempt";
import { ProviderSyncError } from "../provider-sync.error";
import { EpicSyncAuthService } from "./auth/epic-sync-auth.service";
import { EpicLibraryItem, EpicPlaytimeEntry } from "./epic-sync.types";

const LIBRARY_API =
    "https://library-service.live.use1a.on.epicgames.com/library/api/public";
// Unreal Engine marketplace assets share this namespace and are not games.
const UNREAL_ENGINE_NAMESPACE = "ue";

@Injectable()
export class EpicSyncService {
    constructor(private readonly authService: EpicSyncAuthService) {}

    private async get<T>(accountId: string, url: string, params?: object) {
        const accessToken = await this.authService.getAccessToken(accountId);
        return cancellableProviderCall(
            `epicgames:user:${accountId}`,
            async (signal) =>
                (
                    await axios.get<T>(url, {
                        params,
                        headers: { Authorization: `Bearer ${accessToken}` },
                        timeout: 30_000,
                        signal,
                    })
                ).data,
        );
    }

    /** Returns every library item of the account, across all cursor pages, minus Unreal Engine assets. */
    @PlayerLibrarySnapshot()
    public async getLibraryItems(
        accountId: string,
    ): Promise<EpicLibraryItem[]> {
        const items: EpicLibraryItem[] = [];
        let cursor: string | undefined;
        do {
            const page = await this.get<{
                records?: EpicLibraryItem[];
                responseMetadata?: { nextCursor?: string };
            }>(accountId, `${LIBRARY_API}/items`, {
                includeMetadata: true,
                cursor,
            });
            if (!Array.isArray(page?.records)) {
                throw new ProviderSyncError(
                    "incomplete",
                    "Incomplete Epic library response",
                );
            }
            items.push(
                ...page.records.filter(
                    (item) => item.namespace !== UNREAL_ENGINE_NAMESPACE,
                ),
            );
            const next = page.responseMetadata?.nextCursor;
            if (next && next === cursor) {
                throw new ProviderSyncError(
                    "incomplete",
                    "Epic library cursor did not advance",
                );
            }
            cursor = next;
        } while (cursor);
        return items;
    }

    /** Total playtime per app, in seconds. */
    public async getPlaytime(accountId: string): Promise<EpicPlaytimeEntry[]> {
        const entries = await this.get<EpicPlaytimeEntry[]>(
            accountId,
            `${LIBRARY_API}/playtime/account/${encodeURIComponent(accountId)}/all`,
        );
        if (!Array.isArray(entries)) {
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete Epic playtime response",
            );
        }
        return entries;
    }
}
