import { match } from "ts-pattern";
import { GamePlatformAbbreviations } from "../../../game/game-repository/game-repository.constants";

/**
 * Given a PSN api item category, return the platform abbreviation matching {@link GamePlatform#abbreviation}.
 * @param category - "ps4_game" | "ps5_native_game" | "pspc_game" | "unknown"
 */
export function getPsnPlatformAbbreviation(category: string) {
    return match(category)
        .with("ps4_game", () => GamePlatformAbbreviations.PS4)
        .with("ps5_native_game", () => GamePlatformAbbreviations.PS5)
        .with("pspc_game", () => GamePlatformAbbreviations.PSVita)
        .otherwise(() => GamePlatformAbbreviations.PS5);
}
