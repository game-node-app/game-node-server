import { HttpException } from "@nestjs/common";
import {
    assertGameEligible,
    getAwardsPhase,
    isGameEligible,
} from "./awards.utils";

const event = {
    nominationStartDate: new Date("2026-11-03T00:00:00Z"),
    nominationEndDate: new Date("2026-11-16T00:00:00Z"),
    votingStartDate: new Date("2026-12-01T00:00:00Z"),
    votingEndDate: new Date("2026-12-20T00:00:00Z"),
    resultsDate: new Date("2026-12-27T00:00:00Z"),
};

const legacyEvent = {
    nominationStartDate: null,
    nominationEndDate: null,
    votingStartDate: new Date("2026-12-01T00:00:00Z"),
    votingEndDate: new Date("2026-12-20T00:00:00Z"),
    resultsDate: new Date("2026-12-27T00:00:00Z"),
};

describe("getAwardsPhase", () => {
    it.each([
        ["2026-11-02T23:59:59Z", "upcoming"],
        ["2026-11-03T00:00:00Z", "nominations"],
        ["2026-11-15T23:59:59Z", "nominations"],
        ["2026-11-16T00:00:00Z", "nominations_closed"],
        ["2026-11-20T00:00:00Z", "nominations_closed"],
        ["2026-11-30T23:59:59Z", "nominations_closed"],
        ["2026-12-01T00:00:00Z", "voting"],
        ["2026-12-19T23:59:59Z", "voting"],
        ["2026-12-20T00:00:00Z", "voting_closed"],
        ["2026-12-26T23:59:59Z", "voting_closed"],
        ["2026-12-27T00:00:00Z", "results"],
        ["2027-01-15T12:00:00Z", "results"],
    ])("reads %s as %s", (now, phase) => {
        expect(getAwardsPhase(event, new Date(now))).toBe(phase);
    });

    it("never reports a nomination phase for a legacy event", () => {
        expect(
            getAwardsPhase(legacyEvent, new Date("2026-11-10T00:00:00Z")),
        ).toBe("upcoming");
        expect(
            getAwardsPhase(legacyEvent, new Date("2026-11-15T00:00:00Z")),
        ).toBe("upcoming");
        expect(
            getAwardsPhase(legacyEvent, new Date("2026-12-01T00:00:00Z")),
        ).toBe("voting");
        expect(
            getAwardsPhase(legacyEvent, new Date("2026-12-20T00:00:00Z")),
        ).toBe("voting_closed");
        expect(
            getAwardsPhase(legacyEvent, new Date("2026-12-27T00:00:00Z")),
        ).toBe("results");
    });
});

describe("assertGameEligible", () => {
    const eligibleEvent = { year: 2026, eligibilityCutoffDate: null };

    it("accepts a game released in the event year", () => {
        expect(() =>
            assertGameEligible(eligibleEvent, {
                name: "In Year",
                firstReleaseDate: new Date("2026-05-01T00:00:00Z"),
            }),
        ).not.toThrow();
    });

    it("rejects a game released outside the event year with 400", () => {
        let error: unknown;
        try {
            assertGameEligible(eligibleEvent, {
                name: "Old Game",
                firstReleaseDate: new Date("2025-12-31T00:00:00Z"),
            });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(400);
    });

    it("rejects a game released after the cutoff with 400", () => {
        const cutoffEvent = {
            year: 2026,
            eligibilityCutoffDate: new Date("2026-11-30T00:00:00Z"),
        };
        expect(() =>
            assertGameEligible(cutoffEvent, {
                name: "Late Game",
                firstReleaseDate: new Date("2026-12-05T00:00:00Z"),
            }),
        ).toThrow(HttpException);
        expect(() =>
            assertGameEligible(cutoffEvent, {
                name: "On Cutoff Day",
                firstReleaseDate: new Date("2026-11-30T23:00:00Z"),
            }),
        ).not.toThrow();
    });

    it("accepts games without a release date", () => {
        expect(() =>
            assertGameEligible(eligibleEvent, {
                name: "Unknown",
                firstReleaseDate: null as unknown as Date,
            }),
        ).not.toThrow();
    });

    it("reports eligibility without throwing", () => {
        const cutoffEvent = {
            year: 2026,
            eligibilityCutoffDate: new Date("2026-11-30T00:00:00Z"),
        };
        expect(
            isGameEligible(eligibleEvent, {
                name: "In Year",
                firstReleaseDate: new Date("2026-05-01T00:00:00Z"),
            }),
        ).toBe(true);
        expect(
            isGameEligible(eligibleEvent, {
                name: "Old Game",
                firstReleaseDate: new Date("2025-12-31T00:00:00Z"),
            }),
        ).toBe(false);
        expect(
            isGameEligible(cutoffEvent, {
                name: "Late Game",
                firstReleaseDate: new Date("2026-12-05T00:00:00Z"),
            }),
        ).toBe(false);
        expect(
            isGameEligible(cutoffEvent, {
                name: "Unknown",
                firstReleaseDate: null as unknown as Date,
            }),
        ).toBe(true);
    });
});
