import { PartialGame } from "../game-repository/game-repository.types";
import isEmptyObject from "../../utils/isEmptyObject";
import { objectKeysToCamelCase } from "../../utils/case-convert";

/**
 * Recursively converts types of a game object.
 * @param game
 */
const convertIgdbResultTypes = (game: PartialGame) => {
    const validatedGame = game;
    // Keep in mind that these are UNIX timestamps, in seconds.
    const dateFields = [
        "createdAt",
        "created_at",
        "updatedAt",
        "updated_at",
        "firstReleaseDate",
        "first_release_date",
    ];

    for (const [key, value] of Object.entries(validatedGame)) {
        if (value == undefined) {
        } else if (isEmptyObject(value)) {
            validatedGame[key] = undefined;
            // A lot of things are of type object, including dates and arrays, so we need to check for those first
        } else if (typeof value === "object" && value.constructor === Object) {
            validatedGame[key] = convertIgdbResultTypes(value);
        } else if (Array.isArray(value) && value.length > 0) {
            validatedGame[key] = value.map((item) =>
                convertIgdbResultTypes(item),
            );
        } else if (dateFields.includes(key) && typeof value === "number") {
            // Convert UNIX timestamp to JS Date
            validatedGame[key] = new Date(value * 1000);
        }
    }

    return validatedGame;
};

export function normalizeIgdbResults(results: any[]) {
    const normalizedResults: PartialGame[] = [];
    for (const result of results) {
        // Do basic parsing (converts fields to camelCase)
        const normalizedResult: PartialGame = objectKeysToCamelCase(result);

        if (normalizedResult.gameLocalizations) {
            normalizedResult.localizations = normalizedResult.gameLocalizations;
        }

        const convertedResult = convertIgdbResultTypes(normalizedResult);

        normalizedResults.push(convertedResult);
    }

    return normalizedResults;
}
