import { addDays, dailyNextResetAt, dailyToday } from "./daily.constants";

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
