import { getMetadataArgsStorage } from "typeorm";
import { Game } from "../../../game/game-repository/entities/game.entity";
import { IGDB_SYNC_ENDPOINTS } from "./igdb-sync-endpoints";

it("declares every endpoint in sweep order with registered entities and valid routes", () => {
    expect(IGDB_SYNC_ENDPOINTS.map((entry) => entry.endpoint)).toEqual([
        "games",
        "covers",
        "screenshots",
        "artworks",
        "game_videos",
        "alternative_names",
        "involved_companies",
        "external_games",
        "game_localizations",
        "company_logos",
        "companies",
        "platforms",
        "genres",
        "themes",
        "keywords",
        "franchises",
        "game_engines",
        "game_modes",
        "player_perspectives",
    ]);
    for (const entry of IGDB_SYNC_ENDPOINTS) {
        expect(
            getMetadataArgsStorage().tables.some(
                (table) => table.target === entry.local.entity,
            ),
        ).toBe(true);
        expect(["game", "shared"]).toContain(entry.route);
        expect([null, "game", "companies"]).toContain(entry.owner);
        expect(entry.compare).toEqual(
            entry.endpoint === "games"
                ? [
                      {
                          source: "version_parent",
                          column: "versionParentId",
                          target: Game,
                      },
                  ]
                : [],
        );
        expect(entry.local.columns).toContain("checksum");
        expect(entry.fields).toContain("id");
        if (entry.delta) expect(entry.fields).toContain("updated_at");
    }
    const sweepFields = (endpoint: string) =>
        IGDB_SYNC_ENDPOINTS.find((entry) => entry.endpoint === endpoint)!
            .sweepFields;
    expect(sweepFields("covers")).toEqual(["game_localization", "image_type"]);
    expect(sweepFields("artworks")).toEqual(["artwork_type", "image_type"]);
    expect(sweepFields("games")).toBeUndefined();
});
