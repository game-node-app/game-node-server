import { GamePlatformAbbreviations } from "../../../game/game-repository/game-repository.constants";
import { XboxGameTitleDeviceType } from "../xbox-sync.types";
import { getXboxPlatformAbbreviation } from "./get-xbox-platform-abbreviation";

export function getPreferredXboxPlatformAbbreviation(
    deviceTitles: (XboxGameTitleDeviceType | string)[],
) {
    const platformsPreferenceOrder = [
        GamePlatformAbbreviations.XboxSeriesXS,
        GamePlatformAbbreviations.XboxOne,
        GamePlatformAbbreviations.Xbox360,
        GamePlatformAbbreviations.PC,
    ];

    const platformAbbreviations = deviceTitles.map(getXboxPlatformAbbreviation);

    return platformAbbreviations.toSorted((a, b) => {
        return (
            platformsPreferenceOrder.indexOf(a) -
            platformsPreferenceOrder.indexOf(b)
        );
    })[0];
}
