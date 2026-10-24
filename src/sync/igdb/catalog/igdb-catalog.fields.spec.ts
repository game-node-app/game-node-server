import {
    IGDB_CATALOG_FIELDS,
    IGDB_CATALOG_UNUSED_SOURCE_FIELDS,
} from "./igdb-catalog.fields";
import { expandedGame } from "./fixtures/expanded-game";
import { normalizeIgdbGame } from "../utils/game-conversor-utils";

describe("catalog field projection", () => {
    it("covers every leaf of a representative supported source graph", () => {
        const leaves = (value: unknown, prefix = ""): string[] => {
            if (Array.isArray(value))
                return value.flatMap((item) => leaves(item, prefix));
            if (value && typeof value === "object")
                return Object.entries(value).flatMap(([key, item]) =>
                    leaves(item, prefix ? `${prefix}.${key}` : key),
                );
            return [prefix];
        };
        for (const path of leaves(expandedGame()))
            expect(IGDB_CATALOG_FIELDS).toContain(path);
        expect(new Set(IGDB_CATALOG_FIELDS).size).toBe(
            IGDB_CATALOG_FIELDS.length,
        );
        expect(IGDB_CATALOG_FIELDS.some((field) => field.includes("*"))).toBe(
            false,
        );
        expect(IGDB_CATALOG_FIELDS).toEqual(
            expect.arrayContaining([
                "category",
                "status",
                "external_games.category",
                "external_games.media",
            ]),
        );
        expect(IGDB_CATALOG_UNUSED_SOURCE_FIELDS).toHaveLength(6);
    });

    it("retains images, nested metadata, links, external IDs and localization aliases", () => {
        const game = normalizeIgdbGame(expandedGame());
        expect(game.cover).toMatchObject({
            imageId: "image-token",
            alphaChannel: true,
            width: 640,
        });
        expect(game.screenshots?.[0]?.id).toBe(102);
        expect(game.artworks?.[0]?.id).toBe(103);
        expect(game.platforms?.[0]?.name).toBe("Platform");
        expect(game.genres?.[0]?.slug).toBe("resource");
        expect(game.involvedCompanies?.[0]?.company?.logo?.id).toBe(402);
        expect(game.gameEngines?.[0]?.companies?.[0]?.name).toBe("Company");
        expect(game.gameEngines?.[0]?.platforms?.[0]?.id).toBe(301);
        expect(game.dlcs?.[0]?.id).toBe(110);
        expect(game.externalGames[0].uid).toBe("steam-id");
        expect(game.localizations).toEqual(game.gameLocalizations);
        expect(game.gameLocalizations?.[0]?.name).toBe("Localized");
    });
});
