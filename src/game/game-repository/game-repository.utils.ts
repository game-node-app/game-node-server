import { FindOptionsRelations } from "typeorm";
import { EGameCategory, PlatformToIconMap } from "./game-repository.constants";

/**
 * Deterministic cache-key fragment for a relation shape, so `{ cover, platforms }` and
 * `{ platforms, cover }` share per-game cache entries.
 */
export function getRelationsCacheKey(
    relations?: FindOptionsRelations<any>,
): string {
    const normalize = (value: any): any => {
        if (value == null || typeof value !== "object") return value;
        return Object.keys(value)
            .sort()
            .reduce(
                (acc, key) => {
                    acc[key] = normalize(value[key]);
                    return acc;
                },
                {} as Record<string, any>,
            );
    };

    return JSON.stringify(normalize(relations ?? {}));
}

export function getIconNamesForPlatformAbbreviations(abbreviations: string[]) {
    const iconsNames: string[] = [];
    for (const [iconName, platforms] of Object.entries(PlatformToIconMap)) {
        const abbreviationPresent = abbreviations.some((abbreviation) =>
            platforms.includes(abbreviation),
        );
        if (abbreviationPresent) {
            iconsNames.push(iconName);
        }
    }

    return iconsNames;
}

export function getIconNameForPlatformAbbreviation(abbreviation: string) {
    for (const [iconName, platforms] of Object.entries(PlatformToIconMap)) {
        if (platforms.includes(abbreviation)) {
            return iconName;
        }
    }

    return undefined;
}

/**
 * Based on a game's category id, retrieves its readable name.
 * @param category
 */
export function getGameCategoryName(category: number | undefined) {
    // Converts category to a number
    switch (category) {
        case EGameCategory.Main:
            return "Game";
        case EGameCategory.DlcAddon:
            return "DLC";
        case EGameCategory.Bundle:
            return "Bundle";
        case EGameCategory.Expansion:
            return "Expansion";
        case EGameCategory.StandaloneExpansion:
            return "Expansion";
        case EGameCategory.Mod:
            return "Mod";
        case EGameCategory.Episode:
            return "Episode";
        case EGameCategory.Season:
            return "Season";
        case EGameCategory.Remake:
            return "Remake";
        case EGameCategory.Remaster:
            return "Remaster";
        case EGameCategory.ExpandedGame:
            return "Expanded Game";
        case EGameCategory.Port:
            return "Port";
        case EGameCategory.Fork:
            return "Fork";
        case EGameCategory.Pack:
            return "Pack";
        case EGameCategory.Update:
            return "Update";
        default:
            return undefined;
    }
}
