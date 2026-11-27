import { GamePlatformAbbreviations } from "../../../game/game-repository/game-repository.constants";
import { getPreferredXboxPlatformAbbreviation } from "./get-preferred-xbox-platform-abbreviation";

test("a title without devices still resolves to a platform", () => {
    expect(getPreferredXboxPlatformAbbreviation([])).toBe(
        GamePlatformAbbreviations.XboxSeriesXS,
    );
});

test("the newest console wins over older consoles and PC", () => {
    expect(
        getPreferredXboxPlatformAbbreviation(["PC", "Xbox360", "XboxOne"]),
    ).toBe(GamePlatformAbbreviations.XboxOne);
});
