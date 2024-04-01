import {
    EGameExternalGameCategory,
    externalGameCategoryToIconMap,
    platformAbbreviationToIconMap,
} from "./game-repository.constants";

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
    }

    return null;
}

/**
 * Store uid is the id for a game used on the target store. <br>
 * See game-external-game.entity.ts for reference.
 * @param category
 * @param storeUid
 */
export function getStoreUrlForCategory(category: number, storeUid: string) {
    switch (category) {
        case EGameExternalGameCategory.Steam:
            return `https://store.steampowered.com/app/${storeUid}`;
    }

    return null;
}
