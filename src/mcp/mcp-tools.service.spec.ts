import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ThrottlerStorageService } from "@nestjs/throttler";
import { EntityNotFoundError } from "typeorm";
import { AuthService } from "../auth/auth.service";
import { SearchService } from "../search/search.service";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { CollectionsService } from "../collections/collections.service";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { CollectionEntryStatus as Status } from "../collections/collections-entries/collections-entries.constants";
import { ReviewsService } from "../reviews/reviews.service";
import { PostsService } from "../posts/posts.service";
import { McpToolsService } from "./mcp-tools.service";

describe("McpToolsService", () => {
    const auth = { getLockoutStates: jest.fn() };
    const search = { searchGames: jest.fn() };
    const games = { findOneByIdOrFail: jest.fn() };
    const collections = { findAllByUserIdWithPermissions: jest.fn() };
    const entries = {
        findOneByUserIdAndGameId: jest.fn(),
        findOneByUserIdAndGameIdOrFail: jest.fn(),
        createOrUpdate: jest.fn(),
    };
    const reviews = {
        getScore: jest.fn(),
        findOneByUserIdAndGameId: jest.fn(),
        createOrUpdate: jest.fn(),
    };
    const posts = { create: jest.fn() };
    const entry = {
        status: Status.PLAYING,
        ownedPlatforms: [{ id: 6, name: "PC" }],
        collections: [
            { id: "a", name: "Favorites" },
            { id: "b", name: "Backlog" },
        ],
        isFavorite: true,
        startedAt: new Date("2026-01-01Z"),
        finishedAt: null,
    };
    let service: McpToolsService;
    let storage: ThrottlerStorageService;

    beforeEach(() => {
        jest.resetAllMocks();
        storage = new ThrottlerStorageService();
        service = new McpToolsService(
            new ConfigService({ DOMAIN_WEBSITE: "https://gamenode.test" }),
            auth as unknown as AuthService,
            storage,
            search as unknown as SearchService,
            games as unknown as GameRepositoryService,
            collections as unknown as CollectionsService,
            entries as unknown as CollectionsEntriesService,
            reviews as unknown as ReviewsService,
            posts as unknown as PostsService,
        );
        auth.getLockoutStates.mockResolvedValue(new Map());
        games.findOneByIdOrFail.mockResolvedValue({
            id: 1,
            name: "Game",
            summary: "Summary",
            firstReleaseDate: "2026-01-01Z",
            platforms: [{ id: 6, name: "PC" }],
            genres: [{ name: "RPG" }],
            cover: { url: "//images.test/t_thumb/cover.jpg" },
            hidden: "omit",
        });
        entries.findOneByUserIdAndGameIdOrFail.mockResolvedValue(entry);
        posts.create.mockResolvedValue({ id: "post" });
    });

    afterEach(() => storage.onApplicationShutdown());

    it.each([
        { isSuspended: true, isBanned: false },
        { isSuspended: false, isBanned: true },
    ])("refuses all writes for a restricted user (%j)", async (state) => {
        auth.getLockoutStates.mockResolvedValue(new Map([["user", state]]));
        const results = await Promise.all([
            service.createPost("user", { game_id: 1, content: "hello" }),
            service.reviewGame("user", {
                game_id: 1,
                rating: 4,
                overwrite: false,
            }),
            service.addGameToLibrary("user", {
                game_id: 1,
                status: Status.PLAYING,
                platform_ids: [6],
            }),
        ]);
        expect(results.every((result) => result.isError)).toBe(true);
        expect(results[0].content[0]).toMatchObject({
            text: expect.stringContaining("restricted"),
        });
        expect(posts.create).not.toHaveBeenCalled();
        expect(reviews.createOrUpdate).not.toHaveBeenCalled();
        expect(entries.createOrUpdate).not.toHaveBeenCalled();
    });

    it("shares the ten-write limit across tools, keeps other users independent and reads available", async () => {
        reviews.findOneByUserIdAndGameId.mockResolvedValue({
            id: "review",
            rating: 4,
            content: null,
        });
        for (let i = 0; i < 5; i++) {
            expect(
                (
                    await service.createPost("user", {
                        game_id: 1,
                        content: "hello",
                    })
                ).isError,
            ).toBeUndefined();
            expect(
                (
                    await service.reviewGame("user", {
                        game_id: 1,
                        rating: 4,
                        overwrite: true,
                    })
                ).isError,
            ).toBeUndefined();
        }
        expect(
            (
                await service.createPost("user", {
                    game_id: 1,
                    content: "blocked",
                })
            ).content[0],
        ).toMatchObject({ text: expect.stringContaining("Try again in") });
        expect(posts.create).toHaveBeenCalledTimes(5);
        expect(
            (await service.createPost("other", { game_id: 1, content: "ok" }))
                .isError,
        ).toBeUndefined();
        expect(
            (await service.getLibraryEntry("user", { game_id: 1 })).isError,
        ).toBeUndefined();
    });

    it("returns compact search results in engine order", async () => {
        search.searchGames.mockResolvedValue({
            data: {
                items: [
                    {
                        id: 2,
                        name: "Second",
                        firstReleaseDate: "2020-01-01",
                        platformsNames: "PC, Switch",
                        storyline: "omit",
                    },
                    { id: 1, name: "First" },
                ],
            },
            pagination: { totalItems: 2, hasNextPage: false },
        });
        const result = await service.searchGames({
            query: "game",
            limit: 10,
            page: 2,
        });
        expect(search.searchGames).toHaveBeenCalledWith({
            query: "game",
            limit: 10,
            page: 2,
        });
        expect(result.structuredContent).toEqual({
            total: 2,
            has_next_page: false,
            games: [
                {
                    id: 2,
                    name: "Second",
                    first_release_year: 2020,
                    platforms: ["PC", "Switch"],
                },
                {
                    id: 1,
                    name: "First",
                    first_release_year: null,
                    platforms: [],
                },
            ],
        });
    });

    it("returns game platform ids, score and compact details as text and structured content", async () => {
        reviews.getScore.mockResolvedValue({
            median: 4.5,
            distribution: { total: 2 },
        });
        const result = await service.getGame({ id: 1 });
        expect(result.structuredContent).toMatchObject({
            platforms: [{ id: 6, name: "PC" }],
            cover_url: "https://images.test/t_cover_big/cover.jpg",
            gamenode_review_score: 4.5,
        });
        expect(result.structuredContent).not.toHaveProperty("hidden");
        expect(result.content[0]).toEqual({
            type: "text",
            text: JSON.stringify(result.structuredContent),
        });
    });

    it("returns not-found errors for unknown games without writing a post", async () => {
        games.findOneByIdOrFail.mockRejectedValue(
            new EntityNotFoundError("Game", { id: 99 }),
        );
        expect((await service.getGame({ id: 99 })).isError).toBe(true);
        expect(
            (
                await service.createPost("user", {
                    game_id: 99,
                    content: "hello",
                })
            ).isError,
        ).toBe(true);
        expect(posts.create).not.toHaveBeenCalled();
    });

    it("reads only the acting user's entry and collections, including private collections", async () => {
        entries.findOneByUserIdAndGameId
            .mockResolvedValueOnce(entry)
            .mockResolvedValueOnce(null);
        expect(
            (await service.getLibraryEntry("user", { game_id: 1 }))
                .structuredContent,
        ).toMatchObject({
            in_library: true,
            status: "playing",
            is_favorite: true,
            started_at: "2026-01-01T00:00:00.000Z",
            collections: entry.collections,
        });
        expect(
            (await service.getLibraryEntry("other", { game_id: 1 }))
                .structuredContent,
        ).toEqual({ game_id: 1, in_library: false });
        expect(entries.findOneByUserIdAndGameId.mock.calls).toEqual([
            ["user", 1],
            ["other", 1],
        ]);
        collections.findAllByUserIdWithPermissions.mockResolvedValue([
            {
                id: "private",
                name: "Private",
                defaultEntryStatus: Status.PLANNED,
            },
        ]);
        expect(
            (await service.listCollections("user")).structuredContent,
        ).toEqual({
            collections: [
                { id: "private", name: "Private", default_status: "planned" },
            ],
        });
        expect(collections.findAllByUserIdWithPermissions).toHaveBeenCalledWith(
            "user",
            "user",
        );
    });

    it("creates a new library entry", async () => {
        const result = await service.addGameToLibrary("user", {
            game_id: 1,
            status: Status.PLAYING,
            platform_ids: [6],
        });
        expect(result.structuredContent).toMatchObject({ created: true });
        expect(entries.createOrUpdate).toHaveBeenCalledWith("user", {
            gameId: 1,
            status: Status.PLAYING,
            platformIds: [6],
            collectionIds: [],
            finishedAt: undefined,
        });
    });

    it.each([undefined, ["b", "c"]])(
        "keeps platforms and unions existing collections with %j",
        async (collection_ids) => {
            entries.findOneByUserIdAndGameId.mockResolvedValue(entry);
            const result = await service.addGameToLibrary("user", {
                game_id: 1,
                status: Status.FINISHED,
                collection_ids,
            });
            expect(result.structuredContent).toMatchObject({ created: false });
            expect(entries.createOrUpdate).toHaveBeenCalledWith(
                "user",
                expect.objectContaining({
                    platformIds: [6],
                    collectionIds: collection_ids
                        ? ["a", "b", "c"]
                        : ["a", "b"],
                }),
            );
        },
    );

    it("rejects invalid platforms and missing platforms on a new entry", async () => {
        for (const platform_ids of [[999], undefined]) {
            expect(
                (
                    await service.addGameToLibrary("user", {
                        game_id: 1,
                        status: Status.PLANNED,
                        platform_ids,
                    })
                ).isError,
            ).toBe(true);
        }
        expect(entries.createOrUpdate).not.toHaveBeenCalled();
    });

    it("reports the shared service's collection ownership refusal", async () => {
        entries.createOrUpdate.mockRejectedValue(
            new ForbiddenException("Collection does not belong to this user"),
        );
        const result = await service.addGameToLibrary("user", {
            game_id: 1,
            status: Status.PLANNED,
            platform_ids: [6],
            collection_ids: ["foreign"],
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]).toMatchObject({
            text: expect.stringContaining("does not belong"),
        });
    });

    it("creates a review with escaped content", async () => {
        reviews.findOneByUserIdAndGameId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                id: "review",
                rating: 4,
                content: "<p>Great</p>",
            });
        expect(
            (
                await service.reviewGame("user", {
                    game_id: 1,
                    rating: 4,
                    content: "Great <img onerror=x>",
                    overwrite: false,
                })
            ).structuredContent,
        ).toMatchObject({ created: true, review: { id: "review" } });
        expect(reviews.createOrUpdate).toHaveBeenCalledWith("user", {
            gameId: 1,
            rating: 4,
            content: "<p>Great &lt;img onerror=x&gt;</p>",
        });
    });

    it("explains how to review a game missing from the library", async () => {
        reviews.createOrUpdate.mockRejectedValue(
            new NotFoundException("Collection entry not found"),
        );
        expect(
            (
                await service.reviewGame("user", {
                    game_id: 1,
                    rating: 4,
                    overwrite: false,
                })
            ).content[0],
        ).toMatchObject({
            text: expect.stringContaining("add_game_to_library"),
        });
    });

    it("returns the existing review unchanged unless overwrite is explicit", async () => {
        const review = { id: "review", rating: 3, content: "<p>Keep me</p>" };
        reviews.findOneByUserIdAndGameId.mockResolvedValue(review);
        const result = await service.reviewGame("user", {
            game_id: 1,
            rating: 5,
            overwrite: false,
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]).toMatchObject({
            text: expect.stringContaining(
                JSON.stringify({ existing_review: review }),
            ),
        });
        expect(reviews.createOrUpdate).not.toHaveBeenCalled();
        await service.reviewGame("user", {
            game_id: 1,
            rating: 5,
            overwrite: true,
        });
        expect(reviews.createOrUpdate).toHaveBeenCalledWith("user", {
            gameId: 1,
            rating: 5,
        });
    });

    it("creates a post with escaped paragraphs and returns its id", async () => {
        const result = await service.createPost("user", {
            game_id: 1,
            content: "Hello <img onerror=x>\n\nWorld",
        });
        expect(posts.create).toHaveBeenCalledWith("user", {
            gameId: 1,
            content: "<p>Hello &lt;img onerror=x&gt;</p><p>World</p>",
        });
        expect(result.structuredContent).toEqual({ id: "post", game_id: 1 });
    });
});
