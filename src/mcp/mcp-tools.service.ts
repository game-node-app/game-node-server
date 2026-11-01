import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ThrottlerStorage } from "@nestjs/throttler";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { EntityNotFoundError } from "typeorm";
import { AuthService } from "../auth/auth.service";
import { SearchService } from "../search/search.service";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { CollectionsService } from "../collections/collections.service";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { ReviewsService } from "../reviews/reviews.service";
import { PostsService } from "../posts/posts.service";
import { plainTextToHtml } from "./mcp-content";
import { MCP_WRITE_LIMIT, MCP_WRITE_WINDOW_MS } from "./mcp.constants";

const ok = (data: object): CallToolResult => ({
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
});

const fail = (message: string, data?: object): CallToolResult => ({
    isError: true,
    content: [
        {
            type: "text",
            text: data ? `${message}\n${JSON.stringify(data)}` : message,
        },
    ],
});

// Strings too: @Cacheable results come back from JSON.
const dateOrNull = (date?: Date | string | null) =>
    date ? new Date(date).toISOString() : null;

// IGDB stores protocol-relative thumbnail URLs.
const coverUrl = (url?: string) => {
    if (!url) return null;
    const big = url.replace("t_thumb", "t_cover_big");
    return big.startsWith("//") ? `https:${big}` : big;
};

/**
 * Implements the MCP tools on top of the existing services, so writes have the same side effects as the
 * website's. Every method acts as `userId` (the token's `sub`) and returns a tool result instead of throwing
 * for expected failures.
 */
@Injectable()
export class McpToolsService {
    private readonly logger = new Logger(McpToolsService.name);
    private readonly websiteUrl: string;

    constructor(
        configService: ConfigService,
        private readonly authService: AuthService,
        @Inject(ThrottlerStorage)
        private readonly throttlerStorage: ThrottlerStorage,
        private readonly searchService: SearchService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly collectionsService: CollectionsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly reviewsService: ReviewsService,
        private readonly postsService: PostsService,
    ) {
        this.websiteUrl = configService.getOrThrow<string>("DOMAIN_WEBSITE");
    }

    /**
     * Turns the service's own HTTP errors (403 foreign collection, 404 missing entry, ...) into tool errors.
     */
    private async run(
        action: () => Promise<CallToolResult>,
        onNotFound?: string,
    ): Promise<CallToolResult> {
        try {
            return await action();
        } catch (error) {
            if (error instanceof EntityNotFoundError) {
                return fail(onNotFound ?? "Not found.");
            }
            if (error instanceof HttpException && error.getStatus() < 500) {
                return fail(
                    error.getStatus() === 404 && onNotFound
                        ? onNotFound
                        : error.message,
                );
            }
            this.logger.error(error);
            throw error;
        }
    }

    /**
     * Covers access tokens that outlive a lockout (up to 1h) and runaway agents.
     * Returns an error result when the write must not happen.
     */
    private async assertCanWrite(
        userId: string,
    ): Promise<CallToolResult | undefined> {
        const state = (await this.authService.getLockoutStates([userId])).get(
            userId,
        );
        if (state?.isBanned || state?.isSuspended) {
            return fail(
                "Your GameNode account is restricted (suspended or banned), so this action is not allowed.",
            );
        }
        // The Redis store rejects a zero block duration, so block for the window.
        const record = await this.throttlerStorage.increment(
            `mcp:write:${userId}`,
            MCP_WRITE_WINDOW_MS,
            MCP_WRITE_LIMIT,
            MCP_WRITE_WINDOW_MS,
            "mcp-write",
        );
        if (record.isBlocked) {
            return fail(
                `Write limit reached (${MCP_WRITE_LIMIT} per minute). Try again in ${record.timeToBlockExpire} seconds.`,
            );
        }
    }

    async searchGames(input: {
        query: string;
        limit: number;
        page?: number;
    }): Promise<CallToolResult> {
        const { data, pagination } = await this.searchService.searchGames({
            query: input.query,
            limit: input.limit,
            page: input.page,
        });
        return ok({
            total: pagination.totalItems,
            has_next_page: pagination.hasNextPage,
            games: data.items.map((game) => ({
                id: game.id,
                name: game.name,
                first_release_year: game.firstReleaseDate
                    ? new Date(game.firstReleaseDate).getUTCFullYear()
                    : null,
                platforms: game.platformsNames?.split(", ") ?? [],
            })),
        });
    }

    async getGame(input: { id: number }): Promise<CallToolResult> {
        return this.run(async () => {
            const game = await this.gameRepositoryService.findOneByIdOrFail(
                input.id,
                { relations: { cover: true, genres: true, platforms: true } },
            );
            const score = await this.reviewsService.getScore(game.id);
            return ok({
                id: game.id,
                name: game.name,
                summary: game.summary ?? null,
                first_release_date: dateOrNull(game.firstReleaseDate),
                genres: game.genres.map((genre) => genre.name),
                platforms: game.platforms.map((platform) => ({
                    id: platform.id,
                    name: platform.name,
                })),
                cover_url: coverUrl(game.cover?.url),
                gamenode_review_score:
                    score.distribution.total > 0 ? score.median : null,
                gamenode_review_count: score.distribution.total,
                url: `${this.websiteUrl}/game/${game.id}`,
            });
        }, `No game found with id ${input.id}.`);
    }

    private summarizeEntry(entry: CollectionEntry) {
        return {
            in_library: true,
            status: entry.status,
            platforms: entry.ownedPlatforms.map((platform) => ({
                id: platform.id,
                name: platform.name,
            })),
            collections: entry.collections.map((collection) => ({
                id: collection.id,
                name: collection.name,
            })),
            is_favorite: entry.isFavorite,
            planned_at: dateOrNull(entry.plannedAt),
            started_at: dateOrNull(entry.startedAt),
            finished_at: dateOrNull(entry.finishedAt),
            dropped_at: dateOrNull(entry.droppedAt),
        };
    }

    async getLibraryEntry(
        userId: string,
        input: { game_id: number },
    ): Promise<CallToolResult> {
        const entry =
            await this.collectionsEntriesService.findOneByUserIdAndGameId(
                userId,
                input.game_id,
            );
        return ok(
            entry
                ? { game_id: input.game_id, ...this.summarizeEntry(entry) }
                : { game_id: input.game_id, in_library: false },
        );
    }

    async listCollections(userId: string): Promise<CallToolResult> {
        const collections =
            await this.collectionsService.findAllByUserIdWithPermissions(
                userId,
                userId,
            );
        return ok({
            collections: collections.map((collection) => ({
                id: collection.id,
                name: collection.name,
                default_status: collection.defaultEntryStatus,
            })),
        });
    }

    async addGameToLibrary(
        userId: string,
        input: {
            game_id: number;
            status: CollectionEntryStatus;
            platform_ids?: number[];
            collection_ids?: string[];
        },
    ): Promise<CallToolResult> {
        const blocked = await this.assertCanWrite(userId);
        if (blocked) return blocked;
        return this.run(async () => {
            const game = await this.gameRepositoryService.findOneByIdOrFail(
                input.game_id,
                { relations: { platforms: true } },
            );
            const existing =
                await this.collectionsEntriesService.findOneByUserIdAndGameId(
                    userId,
                    game.id,
                );
            const platformIds =
                input.platform_ids ??
                existing?.ownedPlatforms.map((platform) => platform.id) ??
                [];
            if (platformIds.length === 0) {
                return fail(
                    "platform_ids is required when adding a game. Use get_game to see the game's platforms.",
                );
            }
            const gamePlatformIds = new Set(
                game.platforms.map((platform) => platform.id),
            );
            const invalid = platformIds.filter(
                (id) => !gamePlatformIds.has(id),
            );
            if (invalid.length > 0) {
                return fail(
                    `platform_ids ${invalid.join(", ")} not available for this game. Valid ids: ${[...gamePlatformIds].join(", ")}.`,
                );
            }
            // createOrUpdate replaces an entry's collections, so keep the current ones.
            const collectionIds = [
                ...new Set([
                    ...(existing?.collections.map(({ id }) => id) ?? []),
                    ...(input.collection_ids ?? []),
                ]),
            ];
            await this.collectionsEntriesService.createOrUpdate(userId, {
                gameId: game.id,
                status: input.status,
                platformIds,
                collectionIds,
                finishedAt: existing?.finishedAt,
            });
            const entry =
                await this.collectionsEntriesService.findOneByUserIdAndGameIdOrFail(
                    userId,
                    game.id,
                );
            return ok({
                created: !existing,
                game_id: game.id,
                ...this.summarizeEntry(entry),
            });
        }, `No game found with id ${input.game_id}.`);
    }

    async reviewGame(
        userId: string,
        input: {
            game_id: number;
            rating: number;
            content?: string;
            overwrite: boolean;
        },
    ): Promise<CallToolResult> {
        const blocked = await this.assertCanWrite(userId);
        if (blocked) return blocked;
        const summarize = (review: {
            id: string;
            rating: number;
            content: string | null;
        }) => ({
            id: review.id,
            rating: review.rating,
            content: review.content,
        });
        return this.run(async () => {
            const existing = await this.reviewsService.findOneByUserIdAndGameId(
                userId,
                input.game_id,
            );
            if (existing && !input.overwrite) {
                return fail(
                    "You already reviewed this game; nothing was changed. Call review_game again with overwrite: true to replace it.",
                    { existing_review: summarize(existing) },
                );
            }
            await this.reviewsService.createOrUpdate(userId, {
                gameId: input.game_id,
                rating: input.rating,
                ...(input.content !== undefined && {
                    content: plainTextToHtml(input.content),
                }),
            });
            const review = await this.reviewsService.findOneByUserIdAndGameId(
                userId,
                input.game_id,
            );
            return ok({
                created: !existing,
                review: review && summarize(review),
            });
        }, "This game is not in your library. Add it with add_game_to_library first.");
    }

    async createPost(
        userId: string,
        input: { game_id: number; content: string },
    ): Promise<CallToolResult> {
        const blocked = await this.assertCanWrite(userId);
        if (blocked) return blocked;
        return this.run(async () => {
            await this.gameRepositoryService.findOneByIdOrFail(input.game_id);
            const post = await this.postsService.create(userId, {
                gameId: input.game_id,
                content: plainTextToHtml(input.content),
            });
            return ok({ id: post.id, game_id: input.game_id });
        }, `No game found with id ${input.game_id}.`);
    }
}
