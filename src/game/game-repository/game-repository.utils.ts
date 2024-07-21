import {
    EGameCategory,
    EGameExternalGameCategory,
    externalGameCategoryToIconMap,
    platformAbbreviationToIconMap,
} from "./game-repository.constants";
import { Game } from "./entities/game.entity";

export function getIconNamesForPlatformAbbreviations(abbreviations: string[]) {
    const iconsNames: string[] = [];
    for (const [iconName, platforms] of Object.entries(
        platformAbbreviationToIconMap,
    )) {
        const abbreviationPresent = abbreviations.some((abbreviation) =>
            platforms.includes(abbreviation),
        );
        if (abbreviationPresent) {
            iconsNames.push(iconName);
        }
    }

    return iconsNames;
}

export function getIconNameForExternalGameCategory(
    category: number | undefined,
) {
    if (!category) return null;
    for (const [iconName, categories] of Object.entries(
        externalGameCategoryToIconMap,
    )) {
        const categoryPresent = categories.includes(category);
        if (categoryPresent) {
            return iconName;
        }
    }

    return null;
}

export function getStoreNameForExternalGameCategory(
    category: number | undefined,
) {
    if (!category) return null;
    switch (category) {
        case EGameExternalGameCategory.Steam:
            return "Steam";
        case EGameExternalGameCategory.Gog:
            return "GOG";
        case EGameExternalGameCategory.XboxGamePassUltimateCloud:
            return "Xbox Game Pass Cloud";
        case EGameExternalGameCategory.XboxMarketplace:
            return "Xbox Marketplace";
        case EGameExternalGameCategory.Android:
            return "PlayStore";
        case EGameExternalGameCategory.EpicGamesStore:
            return "Epic Games Store";
        case EGameExternalGameCategory.Microsoft:
            return "Microsoft Store";
        case EGameExternalGameCategory.PlaystationStoreUs:
            return "Playstation Store";
        case EGameExternalGameCategory.Twitch:
            return "Twitch";
    }

    return null;
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
