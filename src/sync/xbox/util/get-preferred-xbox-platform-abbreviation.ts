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

    const preferred = platformAbbreviations.toSorted((a, b) => {
        return (
            platformsPreferenceOrder.indexOf(a) -
            platformsPreferenceOrder.indexOf(b)
        );
    })[0];

    // Xbox returns no devices for some titles; default like unknown device names.
    return preferred ?? GamePlatformAbbreviations.XboxSeriesXS;
}
