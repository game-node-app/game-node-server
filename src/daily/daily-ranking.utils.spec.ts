import { addDays, DailyMode } from "./daily.constants";
import { computeStreaks } from "./daily-ranking.utils";

const TODAY = "2026-03-04";
const day = (days: number) => addDays(TODAY, days);

describe("computeStreaks", () => {
    it("counts a streak that ends today", () => {
        const streaks = computeStreaks(
            [day(-2), day(-1), TODAY].map((date) => ({
                mode: DailyMode.COVER,
                date,
            })),
            TODAY,
        );
        expect(streaks.current).toBe(3);
    });

    it("keeps the streak alive when the player has not played today", () => {
        const wins = Array.from({ length: 5 }, (_, index) => ({
            mode: DailyMode.COVER,
            date: day(index - 5),
        }));
        expect(computeStreaks(wins, TODAY).current).toBe(5);
    });

    it("breaks when the last win was two days ago", () => {
        const streaks = computeStreaks(
            [day(-4), day(-3), day(-2)].map((date) => ({
                mode: DailyMode.COVER,
                date,
            })),
            TODAY,
        );
        expect(streaks.current).toBe(0);
    });

    it("counts any mode for the current streak and the best run per mode", () => {
        const streaks = computeStreaks(
            [
                { mode: DailyMode.COVER, date: day(-6) },
                { mode: DailyMode.COVER, date: day(-5) },
                { mode: DailyMode.COVER, date: day(-4) },
                { mode: DailyMode.SPECS, date: day(-1) },
                { mode: DailyMode.SPECS, date: TODAY },
                { mode: DailyMode.SPECS, date: day(-1) },
            ],
            TODAY,
        );
        expect(streaks.current).toBe(2);
        expect(streaks.best).toEqual({
            cover: 3,
            artwork: 0,
            keywords: 0,
            specs: 2,
        });
    });
});
