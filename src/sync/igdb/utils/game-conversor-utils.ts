import { IGDBPartialGame } from "../../../game/game-repository/game-repository.types";
import isEmptyObject from "../../../utils/isEmptyObject";

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
/**
 * Recursively converts types of a game object.
 * @param game
 */
const convertIgdbResultTypes = (game: IGDBPartialGame) => {
    const gameWithParsedDates = parseGameDates(game);

    for (const [key, value] of Object.entries(gameWithParsedDates)) {
        if (value == undefined) {
        } else if (isEmptyObject(value)) {
            gameWithParsedDates[key] = undefined;
            // A lot of things are of type object, including dates and arrays, so we need to check for those first
        } else if (typeof value === "object" && value.constructor === Object) {
            gameWithParsedDates[key] = convertIgdbResultTypes(value);
        } else if (Array.isArray(value) && value.length > 0) {
            gameWithParsedDates[key] = value.map((item) =>
                convertIgdbResultTypes(item),
            );
        }
    }

    return gameWithParsedDates;
};

export function normalizeIgdbResults(results: any[]) {
    const normalizedResults: IGDBPartialGame[] = [];
    for (const result of results) {
        // Do basic parsing (converts fields to camelCase)
        const normalizedResult: IGDBPartialGame = objectKeysToCamelCase(result);

        if (normalizedResult.gameLocalizations) {
            normalizedResult.localizations = normalizedResult.gameLocalizations;
        }

        const convertedResult = convertIgdbResultTypes(normalizedResult);

        normalizedResults.push(convertedResult);
    }

    return normalizedResults;
}
