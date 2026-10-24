import { IGDBPartialGame } from "../../../game/game-repository/game-repository.types";

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
    const game = normalizeValue(result) as IGDBPartialGame;
    if (game.gameLocalizations) game.localizations = game.gameLocalizations;
    return game;
}
