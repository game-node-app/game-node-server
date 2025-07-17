import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { match, P } from "ts-pattern";

/**
 * Look-up table that matches an icon file to a set of external game categories. <br>
 * Check /public/icons for reference. <br>
 * Format: iconName: [category]
 */
const externalGameCategoryToIconMap: { [p: string]: number[] } = {
    xbox: [
        EGameExternalGameCategory.XboxMarketplace,
        EGameExternalGameCategory.XboxGamePassUltimateCloud,
        EGameExternalGameCategory.Microsoft,
    ],
    steam: [EGameExternalGameCategory.Steam],
    epicgames: [EGameExternalGameCategory.EpicGamesStore],
    android: [EGameExternalGameCategory.Android],
    playstation: [EGameExternalGameCategory.PlaystationStoreUs],
    twitch: [EGameExternalGameCategory.Twitch],
};

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

export function getStoreAbbreviatedNameForExternalGameCategory(
    category: number | undefined,
) {
    return match(category)
        .with(EGameExternalGameCategory.Steam, () => "Steam")
        .with(EGameExternalGameCategory.Gog, () => "GOG")
        .with(EGameExternalGameCategory.PlaystationStoreUs, () => "PSN")
        .with(
            P.union(
                EGameExternalGameCategory.Microsoft,
                EGameExternalGameCategory.XboxMarketplace,
            ),
            () => "Xbox",
        )
        .with(
            EGameExternalGameCategory.XboxGamePassUltimateCloud,
            () => "Xbox GP",
        )
        .otherwise(() => null);
}
