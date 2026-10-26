import {
    parseStatisticsInstant,
    statisticsInstantAtMicros,
} from "./statistics-time";

describe("statistics instants", () => {
    it("normalizes offsets without dropping microseconds", () => {
        expect(parseStatisticsInstant("2025-04-12T12:25:00.123456+02:00")).toMatchObject({
            mysql: "2025-04-12 10:25:00.123456",
            iso: "2025-04-12T10:25:00.123456Z",
            epochMicros: 1_744_453_500_123_456n,
        });
    });

    it("keeps exact fractions across the Unix epoch and rejects invalid calendar dates", () => {
        expect(statisticsInstantAtMicros(-1n).iso).toBe("1969-12-31T23:59:59.999999Z");
        expect(() => parseStatisticsInstant("2025-02-30T10:00:00Z")).toThrow();
    });
});
