import { IGDBPartialGame } from "../../../game/game-repository/game-repository.types";
import { CatalogDataError } from "../catalog/igdb-catalog.client";

export const snakeCaseToCamelCase = (str: string) => {
    if (str == null || str.startsWith("_")) {
        return str;
    }
    return str.replace(/([-_][a-z])/g, (group) =>
        group.toUpperCase().replace("-", "").replace("_", ""),
    );
};

export const objectKeysToCamelCase = (obj: any): any => {
    // Only converts objects which are actual objects (not arrays, not null, not undefined, not numbers, etc)
    if (obj == null || typeof obj !== "object") {
        return obj;
    } else if (Array.isArray(obj)) {
        return obj.map((item) => objectKeysToCamelCase(item));
    }

    const camelCaseObj: any = {};
    // eslint-disable-next-line prefer-const
    for (let [key, value] of Object.entries(obj)) {
        if (typeof value === "object" && value != null) {
            camelCaseObj[snakeCaseToCamelCase(key)] =
                objectKeysToCamelCase(value);
            continue;
        }

        camelCaseObj[snakeCaseToCamelCase(key)] = value;
    }

    return camelCaseObj;
};

/**
 * Parses dates from a game object.
 * @param game
 */
export const parseGameDates = (game: IGDBPartialGame) => {
    const parsedGame = structuredClone(game);
    const dateFields = [
        "createdAt",
        "created_at",
        "updatedAt",
        "updated_at",
        "firstReleaseDate",
        "first_release_date",
        "change_date",
        "changeDate",
        "start_date",
        "startDate",
    ];

    for (const [key, value] of Object.entries(parsedGame)) {
        if (dateFields.includes(key) && typeof value === "number") {
            // IGDB Dates are always returned in seconds, even if they are
            // unix timestamps.
            let asDate: Date | undefined = new Date(value * 1000);

            if (asDate.toString() === "Invalid Date") {
                asDate = undefined;
            }

            parsedGame[key] = asDate;
        }
    }

    return parsedGame;
};
const DATE_FIELDS = new Set([
    "createdAt",
    "updatedAt",
    "firstReleaseDate",
    "changeDate",
    "startDate",
]);

/** Allocate each source subtree once, while converting its keys and date values. */
function normalizeValue(value: any): any {
    if (value == null || typeof value !== "object") return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(normalizeValue);
    const converted: Record<string, any> = {};
    for (const [rawKey, item] of Object.entries(value)) {
        const key = snakeCaseToCamelCase(rawKey);
        if (DATE_FIELDS.has(key) && typeof item === "number") {
            const date = new Date(item * 1000);
            converted[key] = Number.isNaN(date.getTime()) ? undefined : date;
        } else if (
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            !(item instanceof Date) &&
            Object.keys(item).length === 0
        ) {
            converted[key] = undefined;
        } else {
            converted[key] = normalizeValue(item);
        }
    }
    return converted;
}

export function normalizeIgdbGame(
    result: Record<string, unknown>,
): IGDBPartialGame {
    const invalid = (field: string): never => {
        const id = Number.isSafeInteger(result.id) ? result.id : "unknown";
        throw new CatalogDataError(`Game ${id}: invalid videos ${field}`);
    };
    if (result.videos != null) {
        if (!Array.isArray(result.videos)) invalid("collection");
        for (const video of result.videos as unknown[]) {
            if (!video || typeof video !== "object" || Array.isArray(video))
                invalid("entry");
            const entry = video as Record<string, unknown>;
            if (!Number.isSafeInteger(entry.id) || (entry.id as number) <= 0)
                invalid("id");
            for (const field of ["name", "video_id", "checksum"]) {
                if (entry[field] != null && typeof entry[field] !== "string")
                    invalid(field);
            }
            if (
                "game" in entry &&
                (!Number.isSafeInteger(entry.game) ||
                    (entry.game as number) <= 0 ||
                    entry.game !== result.id)
            )
                invalid("game");
        }
    }
    const game = normalizeValue(result) as IGDBPartialGame;
    if (game.videos) {
        for (const video of game.videos) {
            video.name ??= null;
            video.checksum ??= null;
            video.videoId ??= null;
            video.url = video.videoId
                ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`
                : null;
        }
    }
    if (game.gameLocalizations) game.localizations = game.gameLocalizations;
    return game;
}
