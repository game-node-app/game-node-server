import { Injectable } from "@nestjs/common";
import axios from "axios";
import { z } from "zod";
import type { ExternalGameService } from "../../game/external-game/external-game.service";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";
import {
    assertPlayerSyncActive,
    cancellableProviderCall,
    PlayerLibrarySnapshot,
} from "../player-sync-attempt";
import { providerFailure, ProviderSyncError } from "../provider-sync.error";
import { GogSyncAuthService } from "./auth/gog-sync-auth.service";
import { GogAchievement } from "./gog-sync.types";

const productId = z.string().regex(/^[1-9][0-9]*$/);
const pageSchema = z.object({
    total_count: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    next_page_token: z.string().min(1).nullish(),
    items: z.array(
        z.object({
            platform_id: z.string().min(1),
            external_id: z.string().min(1),
            owned: z.boolean(),
        }),
    ),
});
const sessionsSchema = z.object({ time_sum: z.number().nonnegative() });
const achievementSchema = z.object({
    achievement_id: z.string().min(1),
    visible: z.boolean(),
    name: z.string(),
    description: z.string(),
    image_url_unlocked: z.url({ protocol: /^https?$/ }),
    image_url_locked: z.url({ protocol: /^https?$/ }),
    date_unlocked: z.iso.datetime({ offset: true }).nullable(),
});
const achievementsSchema = z.object({
    total_count: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    page_token: z.string(),
    achievements_mode: z.literal("all_visible"),
    next_page_token: z.null().optional(),
    items: z.array(achievementSchema),
});

@Injectable()
export class GogSyncService {
    constructor(private readonly authService: GogSyncAuthService) {}

    private async get(
        accountId: string,
        url: string,
        params?: object,
        locale?: string,
    ) {
        if (!productId.safeParse(accountId).success)
            throw new ProviderSyncError("incomplete", "Invalid GOG account ID");
        const accessToken = await this.authService.getAccessToken(accountId);
        return cancellableProviderCall(
            `gog:user:${accountId}`,
            async (signal) => {
                try {
                    return (
                        await axios.get<unknown>(url, {
                            params,
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                                ...(locale ? { "X-Gog-Lc": locale } : {}),
                            },
                            timeout: 30_000,
                            signal,
                            maxRedirects: 0,
                        })
                    ).data;
                } catch (cause) {
                    const failure = providerFailure("gog", cause);
                    throw new ProviderSyncError(
                        failure.outcome,
                        "GOG data request failed",
                        undefined,
                        failure.status,
                        failure.retryAfterMs,
                    );
                }
            },
        );
    }

    @PlayerLibrarySnapshot()
    public async getLibraryItems(accountId: string): Promise<string[]> {
        const ids = new Set<string>();
        const cursors = new Set<string>();
        let cursor: string | undefined;
        let count = 0;
        let total: number | undefined;
        do {
            const result = pageSchema.safeParse(
                await this.get(
                    accountId,
                    `https://galaxy-library.gog.com/users/${encodeURIComponent(accountId)}/releases`,
                    cursor ? { page_token: cursor } : undefined,
                ),
            );
            if (!result.success)
                throw new ProviderSyncError(
                    "incomplete",
                    "Invalid GOG releases page",
                );
            const page = result.data;
            total ??= page.total_count;
            count += page.items.length;
            if (
                page.total_count !== total ||
                count > total ||
                page.items.length > page.limit
            )
                throw new ProviderSyncError(
                    "incomplete",
                    "Inconsistent GOG releases count",
                );
            for (const item of page.items) {
                if (
                    item.platform_id === "gog" &&
                    !productId.safeParse(item.external_id).success
                )
                    throw new ProviderSyncError(
                        "incomplete",
                        "Invalid GOG product ID",
                    );
                if (item.platform_id === "gog" && item.owned)
                    ids.add(item.external_id);
            }
            const next = page.next_page_token;
            if (next && (cursors.has(next) || count >= total))
                throw new ProviderSyncError(
                    "incomplete",
                    "Invalid GOG releases continuation",
                );
            if (!next && count !== total)
                throw new ProviderSyncError(
                    "incomplete",
                    "Truncated GOG releases response",
                );
            if (next) cursors.add(next);
            cursor = next ?? undefined;
        } while (cursor);
        return [...ids];
    }

    public async getPlaytime(accountId: string, id: string): Promise<number> {
        if (!productId.safeParse(id).success)
            throw new ProviderSyncError("incomplete", "Invalid GOG product ID");
        const result = sessionsSchema.safeParse(
            await this.get(
                accountId,
                `https://gameplay.gog.com/games/${id}/users/${encodeURIComponent(accountId)}/sessions`,
            ),
        );
        if (!result.success || !Number.isSafeInteger(result.data.time_sum * 60))
            throw new ProviderSyncError(
                "incomplete",
                "Invalid GOG cumulative time",
            );
        // Minutes are evidenced by Heroic's display path; the known-game live check remains a rollout gate.
        return result.data.time_sum * 60;
    }

    @PlayerLibrarySnapshot()
    public async getAchievements(
        accountId: string,
        id: string,
        locale = "en-US",
    ): Promise<GogAchievement[]> {
        if (!productId.safeParse(id).success)
            throw new ProviderSyncError("incomplete", "Invalid GOG product ID");
        const result = achievementsSchema.safeParse(
            await this.get(
                accountId,
                `https://gameplay.gog.com/clients/${id}/users/${encodeURIComponent(accountId)}/achievements`,
                undefined,
                locale,
            ),
        );
        if (!result.success)
            throw new ProviderSyncError(
                "incomplete",
                "Invalid GOG achievements response",
            );
        const page = result.data;
        // shortcut: no achievement continuation contract is verified, reject truncation until a capture establishes it.
        if (
            page.items.length !== page.total_count ||
            page.items.length > page.limit ||
            new Set(page.items.map((item) => item.achievement_id)).size !==
                page.items.length
        )
            throw new ProviderSyncError(
                "incomplete",
                "Incomplete GOG achievements snapshot",
            );
        return page.items;
    }

    public async getCatalogueAchievements(id: string) {
        return this.getAchievements(
            await this.authService.getCatalogueAccountId(),
            id,
        );
    }

    public async registerUnmappedGames(
        externalGames: ExternalGameService,
        userId: string,
        accountId: string,
        ids: string[],
    ) {
        if (!ids.length) return;
        const category = EGameExternalGameCategory.Gog;
        const named = await externalGames.findNamedUnmappedUids(category, ids);
        const entries: { sourceUid: string; name?: string }[] = [];
        for (const id of ids) {
            assertPlayerSyncActive();
            let name: string | undefined;
            if (!named.has(id)) {
                try {
                    const product = z
                        .object({
                            id: z.number().int().positive().safe(),
                            title: z.string().min(1),
                            game_type: z.string(),
                        })
                        .safeParse(
                            await this.get(
                                accountId,
                                `https://api.gog.com/products/${encodeURIComponent(id)}`,
                            ),
                        );
                    if (product.success && String(product.data.id) === id) {
                        if (product.data.game_type === "movie") continue;
                        name = product.data.title;
                    }
                } catch {
                    /* Optional metadata must not suppress an unmapped registration. */
                }
            }
            entries.push({ sourceUid: id, name });
        }
        assertPlayerSyncActive();
        await externalGames.registerUnmappedGames(category, entries, userId);
    }
}
