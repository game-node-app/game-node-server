import {
    addDays,
    dailyNextResetAt,
    dailyPoints,
    dailyToday,
    DailyMode,
    DailyStatus,
} from "./daily.constants";

describe("daily dates", () => {
    it("uses the São Paulo calendar day", () => {
        expect(dailyToday(new Date("2026-11-04T02:59:59Z"))).toBe("2026-11-03");
        expect(dailyToday(new Date("2026-11-04T03:00:00Z"))).toBe("2026-11-04");
    });

    it("resets at the next São Paulo midnight", () => {
        expect(dailyNextResetAt("2026-12-31")).toBe("2027-01-01T03:00:00.000Z");
        expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    });
});

describe("daily points", () => {
    it("scores a win by the attempts used, in tenths", () => {
        expect(dailyPoints(DailyMode.COVER, DailyStatus.WON, 1)).toBe(60);
        expect(dailyPoints(DailyMode.COVER, DailyStatus.WON, 3)).toBe(40);
        expect(dailyPoints(DailyMode.COVER, DailyStatus.WON, 6)).toBe(10);
        // One skip plus the correct guess.
        expect(dailyPoints(DailyMode.ARTWORK, DailyStatus.WON, 2)).toBe(50);
        expect(dailyPoints(DailyMode.SPECS, DailyStatus.WON, 1)).toBe(60);
        expect(dailyPoints(DailyMode.SPECS, DailyStatus.WON, 10)).toBe(6);
        // Hint after five guesses, then a win on the sixth: seven attempts.
        expect(dailyPoints(DailyMode.SPECS, DailyStatus.WON, 7)).toBe(24);
    });

    it("scores no points for a loss or unfinished play", () => {
        expect(dailyPoints(DailyMode.COVER, DailyStatus.LOST, 6)).toBe(0);
        expect(dailyPoints(DailyMode.COVER, DailyStatus.IN_PROGRESS, 1)).toBe(
            0,
        );
    });
});
