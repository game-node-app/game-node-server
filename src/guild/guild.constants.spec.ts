import {
    computeGuildRank,
    currentWeekStart,
    DUPLICATE_COSMETIC_BONUS_XP,
    GUILD_INACTIVITY_DAYS,
    GUILD_MAX_ACTIVE_CONTRACTS,
    GuildObjectiveType,
    GuildRank,
    nextMondayRefreshAt,
    weekStartToUtcDate,
} from "./guild.constants";
import {
    GUILD_SYSTEM_TEMPLATES,
    validateGuildQuestRules,
} from "./guild-templates.constants";

describe("guild constants", () => {
    it("keeps the contract cap, duplicate bonus and inactivity window", () => {
        expect(GUILD_MAX_ACTIVE_CONTRACTS).toBe(3);
        expect(DUPLICATE_COSMETIC_BONUS_XP).toBe(50);
        expect(GUILD_INACTIVITY_DAYS).toBe(30);
    });
});

describe("computeGuildRank", () => {
    it.each([
        {
            xp: 0,
            rank: GuildRank.E,
            minXp: 0,
            nextRank: GuildRank.D,
            nextRankXp: 300,
            xpToNextRank: 300,
        },
        {
            xp: 299,
            rank: GuildRank.E,
            minXp: 0,
            nextRank: GuildRank.D,
            nextRankXp: 300,
            xpToNextRank: 1,
        },
        {
            xp: 300,
            rank: GuildRank.D,
            minXp: 300,
            nextRank: GuildRank.C,
            nextRankXp: 800,
            xpToNextRank: 500,
        },
        {
            xp: 799,
            rank: GuildRank.D,
            minXp: 300,
            nextRank: GuildRank.C,
            nextRankXp: 800,
            xpToNextRank: 1,
        },
        {
            xp: 800,
            rank: GuildRank.C,
            minXp: 800,
            nextRank: GuildRank.B,
            nextRankXp: 2_000,
            xpToNextRank: 1_200,
        },
        {
            xp: 1_240,
            rank: GuildRank.C,
            minXp: 800,
            nextRank: GuildRank.B,
            nextRankXp: 2_000,
            xpToNextRank: 760,
        },
        {
            xp: 1_999,
            rank: GuildRank.C,
            minXp: 800,
            nextRank: GuildRank.B,
            nextRankXp: 2_000,
            xpToNextRank: 1,
        },
        {
            xp: 2_000,
            rank: GuildRank.B,
            minXp: 2_000,
            nextRank: GuildRank.A,
            nextRankXp: 4_000,
            xpToNextRank: 2_000,
        },
        {
            xp: 3_999,
            rank: GuildRank.B,
            minXp: 2_000,
            nextRank: GuildRank.A,
            nextRankXp: 4_000,
            xpToNextRank: 1,
        },
        {
            xp: 4_000,
            rank: GuildRank.A,
            minXp: 4_000,
            nextRank: GuildRank.S,
            nextRankXp: 7_500,
            xpToNextRank: 3_500,
        },
        {
            xp: 7_499,
            rank: GuildRank.A,
            minXp: 4_000,
            nextRank: GuildRank.S,
            nextRankXp: 7_500,
            xpToNextRank: 1,
        },
        {
            xp: 7_500,
            rank: GuildRank.S,
            minXp: 7_500,
            nextRank: null,
            nextRankXp: null,
            xpToNextRank: 0,
        },
        {
            xp: 25_000,
            rank: GuildRank.S,
            minXp: 7_500,
            nextRank: null,
            nextRankXp: null,
            xpToNextRank: 0,
        },
    ])(
        "maps $xp XP to rank $rank",
        ({ xp, rank, minXp, nextRank, nextRankXp, xpToNextRank }) => {
            expect(computeGuildRank(xp)).toEqual({
                rank,
                currentRankMinXp: minXp,
                nextRank,
                nextRankXp,
                xpToNextRank,
            });
        },
    );

    it("reports the Figma License example (1,240 XP -> Rank C, 760 to B)", () => {
        expect(computeGuildRank(1_240)).toEqual({
            rank: GuildRank.C,
            currentRankMinXp: 800,
            nextRank: GuildRank.B,
            nextRankXp: 2_000,
            xpToNextRank: 760,
        });
    });
});

describe("guild weekly cycle", () => {
    it("starts on Monday 00:00 São Paulo", () => {
        // Sunday 23:59:59 in São Paulo, already Monday in UTC: still the previous week.
        expect(currentWeekStart(new Date("2026-11-09T02:59:59Z"))).toBe(
            "2026-11-02",
        );
        expect(currentWeekStart(new Date("2026-11-09T03:00:00Z"))).toBe(
            "2026-11-09",
        );
    });

    it("resolves a week start to São Paulo midnight", () => {
        expect(weekStartToUtcDate("2026-11-02").toISOString()).toBe(
            "2026-11-02T03:00:00.000Z",
        );
    });

    it("refreshes on the next Monday, across month and year ends", () => {
        expect(nextMondayRefreshAt("2026-11-02").toISOString()).toBe(
            "2026-11-09T03:00:00.000Z",
        );
        expect(nextMondayRefreshAt("2026-12-28").toISOString()).toBe(
            "2027-01-04T03:00:00.000Z",
        );
    });
});

describe("guild quest rules", () => {
    it("lists the six system templates and accepts their rules", () => {
        expect(GUILD_SYSTEM_TEMPLATES.map(({ key }) => key)).toEqual([
            "forgotten_relic",
            "deep_dive",
            "short_caravan",
            "weekend_sprint",
            "captains_log",
            "on_duty_critic",
        ]);
        for (const template of GUILD_SYSTEM_TEMPLATES)
            expect(
                validateGuildQuestRules(
                    template.objectiveType,
                    template.targetCount,
                    template.criteria,
                ),
            ).toEqual([]);
    });

    it("validates the objective type and target count", () => {
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {}),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.WRITE_REVIEW, 3, {}),
        ).toEqual([]);
        expect(validateGuildQuestRules("watch_trailer", 1, {})).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 0, {}),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1.5, {}),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, "1", {}),
        ).not.toEqual([]);
    });

    it("validates criteria values", () => {
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                gameIds: [1, 2],
                genreIds: [8],
                themeIds: [19],
                keywordIds: [2045],
                maxTimeToBeatHours: 8,
            }),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                gameIds: [0],
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                genreIds: ["8"],
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                keywordIds: [1.5],
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                maxTimeToBeatHours: 0,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                finishedInCurrentMonth: true,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, {
                unsupported: true,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, []),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.FINISH_GAME, 1, "{}"),
        ).not.toEqual([]);
    });

    it("rejects time-to-beat criteria on review quests", () => {
        expect(
            validateGuildQuestRules(GuildObjectiveType.WRITE_REVIEW, 1, {
                finishedInCurrentMonth: true,
            }),
        ).toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.WRITE_REVIEW, 1, {
                maxTimeToBeatHours: 8,
            }),
        ).not.toEqual([]);
        expect(
            validateGuildQuestRules(GuildObjectiveType.WRITE_REVIEW, 1, {
                finishedInCurrentMonth: "yes",
            }),
        ).not.toEqual([]);
    });
});
