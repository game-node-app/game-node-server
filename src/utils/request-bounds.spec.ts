import "reflect-metadata";
import { BadRequestException, Type, ValidationPipe } from "@nestjs/common";
import { BaseFindDto } from "./base-find.dto";
import { BaseCursorFindDto } from "./base-cursor-find.dto";
import { FindCollectionEntriesDto } from "../collections/collections-entries/dto/find-collection-entries.dto";
import { FindCollectionEntriesForCollectionIdDto } from "../collections/collections-entries/dto/find-collection-entries-for-collection-id.dto";
import { GetAchievementsV2RequestDto } from "../achievements/dto/get-achievements-request.dto";
import { FindGamesByCollectionTypeRequestDto } from "../game/game-repository/dto/game-repository-collection.dto";
import { GameRepositoryFindAllDto } from "../game/game-repository/dto/game-repository-find-all.dto";
import { GameRepositoryFilterDto } from "../game/game-repository/dto/game-repository-filter.dto";

// Mirrors main.ts: ValidationPipe({ transform, enableImplicitConversion }).
const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
});

const transform = <T>(
    metatype: Type<T>,
    value: object,
    type: "body" | "query" = "body",
) => pipe.transform(value, { type, metatype }) as Promise<T>;

describe("request bounds", () => {
    it.each([
        [{ limit: "500" }, 100],
        [{ limit: "50" }, 50],
        [{}, 20],
    ])(
        "clamps the base page limit from the query: %j",
        async (query, limit) => {
            await expect(
                transform(BaseFindDto, query, "query"),
            ).resolves.toMatchObject({ limit });
            await expect(
                transform(BaseCursorFindDto, query, "query"),
            ).resolves.toMatchObject({ limit });
        },
    );

    it("still rejects a non-numeric limit", async () => {
        await expect(
            transform(BaseFindDto, { limit: "abc" }, "query"),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("lets whole-set endpoints go up to the large cap, and only those", async () => {
        const limit = 999999;
        await expect(
            transform(FindCollectionEntriesForCollectionIdDto, { limit }),
        ).resolves.toMatchObject({ limit: 1000 });
        await expect(
            transform(FindCollectionEntriesDto, { limit }),
        ).resolves.toMatchObject({ limit: 100 });
        await expect(
            transform(GetAchievementsV2RequestDto, { limit }, "query"),
        ).resolves.toMatchObject({ limit: 1000 });
        await expect(
            transform(FindGamesByCollectionTypeRequestDto, {
                collectionType: "upcoming",
                limit: 1000,
            }),
        ).resolves.toMatchObject({ limit: 1000 });
    });

    it("bounds game ids and relations", async () => {
        // The related games carousel: the largest relations object a client sends.
        const relations = Object.fromEntries(
            [
                "similarGames",
                "dlcOf",
                "dlcs",
                "expansionOf",
                "expansions",
                "remakes",
                "remakeOf",
                "remasters",
                "remasterOf",
            ].map((key) => [key, { cover: true }]),
        );
        const gameIds = Array.from({ length: 1000 }, (_, i) => i + 1);
        // What clients send: the carousel for one game, and whole collections with covers and platforms.
        for (const body of [
            { gameIds: [1], relations },
            { gameIds, relations: { cover: true, platforms: true } },
        ])
            await expect(
                transform(GameRepositoryFindAllDto, body),
            ).resolves.toBeDefined();

        for (const body of [
            { gameIds: [...gameIds, 1001] },
            // The request that took the API down: many games, each with nested relations.
            { gameIds, relations },
            { gameIds: gameIds.slice(0, 100), relations },
            {
                gameIds,
                relations: { cover: true, platforms: true, genres: true },
            },
            { gameIds: [1], relations: { a: { b: { c: true } } } },
            {
                gameIds: [1],
                relations: {
                    ...relations,
                    involvedCompanies: { company: true },
                    screenshots: true,
                },
            },
        ])
            await expect(
                transform(GameRepositoryFindAllDto, body),
            ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("bounds the release calendar's rows and the page offset", async () => {
        await expect(
            transform(FindGamesByCollectionTypeRequestDto, {
                collectionType: "upcoming",
                limit: 1000,
                relations: { cover: true, platforms: true },
            }),
        ).resolves.toBeDefined();
        await expect(
            transform(FindGamesByCollectionTypeRequestDto, {
                collectionType: "upcoming",
                limit: 1000,
                relations: { similarGames: { cover: true } },
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            transform(BaseFindDto, { offset: "10001" }, "query"),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("leaves non-array values to the existing validators", async () => {
        const error = await transform(
            GameRepositoryFilterDto,
            { category: "1" },
            "query",
        ).catch((e: BadRequestException) => e.getResponse());
        expect(JSON.stringify(error)).not.toContain("at most");
    });
});
