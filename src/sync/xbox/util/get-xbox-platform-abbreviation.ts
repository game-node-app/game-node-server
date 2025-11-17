import { GamePlatformAbbreviations } from "../../../game/game-repository/game-repository.constants";
import { XboxGameTitleDeviceType } from "../xbox-sync.types";
import { match, P } from "ts-pattern";

/**
 * From a given Xbox platform name, return its abbreviation matching {@link GamePlatform#abbreviation}.
 */
export function getXboxPlatformAbbreviation(
    deviceTitle: XboxGameTitleDeviceType | string,
) {
    return match(deviceTitle)
        .with(P.union("PC", "Win32"), () => GamePlatformAbbreviations.PC)
        .with("Xbox360", () => GamePlatformAbbreviations.Xbox360)
        .with("XboxOne", () => GamePlatformAbbreviations.XboxOne)
        .with("XboxSeries", () => GamePlatformAbbreviations.XboxSeriesXS)
        .otherwise(() => GamePlatformAbbreviations.XboxSeriesXS);
}
