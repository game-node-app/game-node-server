import { storeUrl } from "./external-game.utils";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";

test.each([
    [
        EGameExternalGameCategory.Steam,
        "https://store.steampowered.com/app/412020",
    ],
    [
        EGameExternalGameCategory.PlaystationStoreUs,
        "https://store.playstation.com/en-us/concept/412020",
    ],
    [
        EGameExternalGameCategory.Microsoft,
        "https://www.xbox.com/en-US/games/store/_/412020",
    ],
    [EGameExternalGameCategory.EpicGamesNamespace, null],
])("storeUrl for category %s", (category, url) => {
    expect(storeUrl(category, "412020")).toBe(url);
});
