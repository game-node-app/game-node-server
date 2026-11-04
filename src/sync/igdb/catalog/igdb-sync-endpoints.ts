import { EntityTarget, ObjectLiteral } from "typeorm";
import { Game } from "../../../game/game-repository/entities/game.entity";
import { GameCompany } from "../../../game/game-repository/entities/game-company.entity";
import { GameCompanyLogo } from "../../../game/game-repository/entities/game-company-logo.entity";
import { GamePropertyPathToEntityMap as entities } from "../../../game/game-repository/create/game-repository-create.constants";
import { IGDB_CATALOG_FIELDS } from "./igdb-catalog.fields";

export interface ComparedField {
    source: string;
    column: string;
    target?: EntityTarget<ObjectLiteral>;
    relation?: string;
}
export interface SyncEndpoint {
    endpoint: string;
    delta: boolean;
    owner: "game" | "companies" | null;
    local: { entity: EntityTarget<ObjectLiteral>; columns: string[] };
    route: "game" | "shared";
    compare: ComparedField[];
    fields: string[];
}
const entry = (
    endpoint: string,
    property: string,
    delta: boolean,
    owner: SyncEndpoint["owner"],
    route: SyncEndpoint["route"],
    entity?: EntityTarget<ObjectLiteral>,
): SyncEndpoint => {
    const prefix = property.replace(
        /[A-Z]/g,
        (letter) => `_${letter.toLowerCase()}`,
    );
    return {
        endpoint,
        delta,
        owner,
        route,
        local: {
            entity: entity ?? entities[property as keyof Game]!,
            columns:
                owner === "game" && endpoint !== "involved_companies"
                    ? ["id", "checksum", "gameId"]
                    : ["id", "checksum"],
        },
        compare: [],
        fields:
            endpoint === "games"
                ? [...IGDB_CATALOG_FIELDS]
                : owner === "game"
                  ? ["id", "game", "updated_at"]
                  : IGDB_CATALOG_FIELDS.filter((field) =>
                        field.startsWith(`${prefix}.`),
                    ).map((field) => field.slice(prefix.length + 1)),
    };
};

export const IGDB_SYNC_ENDPOINTS: SyncEndpoint[] = [
    entry("games", "", true, null, "game", Game),
    entry("covers", "cover", false, "game", "game"),
    entry("screenshots", "screenshots", false, "game", "game"),
    entry("artworks", "artworks", false, "game", "game"),
    entry("game_videos", "videos", false, "game", "game"),
    entry(
        "alternative_names",
        "alternative_names",
        false,
        "game",
        "game",
        entities.alternativeNames,
    ),
    entry("involved_companies", "involvedCompanies", true, "game", "game"),
    entry("external_games", "externalGames", true, "game", "game"),
    entry("game_localizations", "gameLocalizations", true, "game", "game"),
    entry(
        "company_logos",
        "involved_companies.company.logo",
        false,
        "companies",
        "shared",
        GameCompanyLogo,
    ),
    entry(
        "companies",
        "involved_companies.company",
        true,
        null,
        "shared",
        GameCompany,
    ),
    ...[
        ["platforms", "platforms"],
        ["genres", "genres"],
        ["themes", "themes"],
        ["keywords", "keywords"],
        ["franchises", "franchises"],
        ["game_engines", "gameEngines"],
        ["game_modes", "gameModes"],
        ["player_perspectives", "playerPerspectives"],
    ].map(([endpoint, property]) =>
        entry(endpoint, property, true, null, "shared"),
    ),
];
