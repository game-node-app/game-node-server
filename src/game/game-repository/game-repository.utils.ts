import { EGameCategory, PlatformToIconMap } from "./game-repository.constants";

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
