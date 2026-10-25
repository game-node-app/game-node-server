import {
    checkIfGameIsComplete,
    checkIfGameIsPlatinum,
} from "./game-achievement.utils";
import { GameAchievementDto } from "./dto/game-achievement.dto";

test("completion and platinum checks use only the supplied snapshots", () => {
    const catalogue = [
        { externalId: "one" },
        { externalId: "platinum", psnDetails: { trophyType: "platinum" } },
    ] as GameAchievementDto[];
    const obtained = [{ externalId: "one" }, { externalId: "platinum" }];

    expect(checkIfGameIsComplete(catalogue, obtained)).toBe(true);
    expect(checkIfGameIsComplete(catalogue, obtained.slice(0, 1))).toBe(false);
    expect(checkIfGameIsPlatinum(catalogue, obtained)).toBe(true);
    expect(checkIfGameIsPlatinum(catalogue, obtained.slice(0, 1))).toBe(false);
});

test("empty snapshots are neither complete nor platinum", () => {
    expect(checkIfGameIsComplete([], [])).toBe(false);
    expect(checkIfGameIsPlatinum([], [])).toBe(false);
});
