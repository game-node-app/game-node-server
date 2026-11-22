import {
    GuildCategory,
    GuildCriteria,
    GuildObjectiveType,
    GuildRank,
} from "./guild.constants";

/** A code-defined quest every board draws from (design 3). */
export interface GuildQuestTemplate {
    key: string;
    category: GuildCategory;
    rank: GuildRank;
    xpReward: number;
    objectiveType: GuildObjectiveType;
    targetCount: number;
    criteria: GuildCriteria;
    requiresTargetGame: boolean;
    isQuick: boolean;
    rewardKey: string | null;
    /** Days an accepted board contract stays open (design 14). */
    contractDurationDays: number;
}

export const GUILD_SYSTEM_TEMPLATES: readonly GuildQuestTemplate[] = [
    {
        key: "forgotten_relic",
        category: GuildCategory.LIBRARY,
        rank: GuildRank.B,
        xpReward: 250,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "badge_archaeologist",
        contractDurationDays: 21,
    },
    {
        key: "deep_dive",
        category: GuildCategory.LIBRARY,
        rank: GuildRank.C,
        xpReward: 200,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "weekly_chest",
        contractDurationDays: 21,
    },
    {
        key: "short_caravan",
        category: GuildCategory.WEEKLY,
        rank: GuildRank.D,
        xpReward: 150,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: { maxTimeToBeatHours: 8 },
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "weekly_chest",
        contractDurationDays: 7,
    },
    {
        key: "weekend_sprint",
        category: GuildCategory.WEEKLY,
        rank: GuildRank.D,
        xpReward: 140,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "weekly_chest",
        contractDurationDays: 7,
    },
    {
        key: "double_feature",
        category: GuildCategory.WEEKLY,
        rank: GuildRank.C,
        xpReward: 220,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 2,
        criteria: {},
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "weekly_chest",
        contractDurationDays: 7,
    },
    {
        key: "captains_log",
        category: GuildCategory.GAMENODE,
        rank: GuildRank.E,
        xpReward: 80,
        objectiveType: GuildObjectiveType.WRITE_REVIEW,
        targetCount: 1,
        criteria: { finishedInCurrentMonth: true },
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "title_chronist",
        contractDurationDays: 7,
    },
    {
        key: "on_duty_critic",
        category: GuildCategory.GAMENODE,
        rank: GuildRank.D,
        xpReward: 120,
        objectiveType: GuildObjectiveType.WRITE_REVIEW,
        targetCount: 3,
        criteria: {},
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "weekly_chest",
        contractDurationDays: 7,
    },
    {
        key: "quick_take",
        category: GuildCategory.GAMENODE,
        rank: GuildRank.E,
        xpReward: 60,
        objectiveType: GuildObjectiveType.WRITE_REVIEW,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "weekly_chest",
        contractDurationDays: 7,
    },
];

const ID_ARRAY_KEYS = [
    "gameIds",
    "genreIds",
    "themeIds",
    "keywordIds",
] as const;

/** Criteria keys each objective understands; everything else is an admin mistake. */
const CRITERIA_KEYS: Record<GuildObjectiveType, readonly string[]> = {
    [GuildObjectiveType.FINISH_GAME]: [...ID_ARRAY_KEYS, "maxTimeToBeatHours"],
    [GuildObjectiveType.WRITE_REVIEW]: [
        ...ID_ARRAY_KEYS,
        "finishedInCurrentMonth",
    ],
};

const isPositiveInteger = (value: unknown): value is number =>
    Number.isInteger(value) && (value as number) > 0;

export const isGuildObjectiveType = (
    value: unknown,
): value is GuildObjectiveType =>
    Object.values(GuildObjectiveType).includes(value as GuildObjectiveType);

/**
 * Error messages for admin-supplied quest rules (objective, target and criteria);
 * empty when the rules are valid.
 */
export function validateGuildQuestRules(
    objectiveType: unknown,
    targetCount: unknown,
    criteria: unknown,
): string[] {
    if (!isGuildObjectiveType(objectiveType))
        return [
            `objectiveType must be one of ${Object.values(GuildObjectiveType).join(", ")}`,
        ];

    const errors: string[] = [];
    if (!Number.isInteger(targetCount) || (targetCount as number) < 1)
        errors.push("targetCount must be an integer >= 1");

    if (criteria == null) return errors;
    if (typeof criteria !== "object" || Array.isArray(criteria))
        return [...errors, "criteria must be an object"];

    const supported = CRITERIA_KEYS[objectiveType];
    for (const [key, value] of Object.entries(criteria)) {
        if (!supported.includes(key)) {
            errors.push(`criteria.${key} is not supported by ${objectiveType}`);
            continue;
        }
        if ((ID_ARRAY_KEYS as readonly string[]).includes(key)) {
            if (!Array.isArray(value) || !value.every(isPositiveInteger))
                errors.push(
                    `criteria.${key} must be an array of positive integers`,
                );
            continue;
        }
        if (
            key === "maxTimeToBeatHours" &&
            (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        )
            errors.push(
                "criteria.maxTimeToBeatHours must be a positive number",
            );
        if (key === "finishedInCurrentMonth" && typeof value !== "boolean")
            errors.push("criteria.finishedInCurrentMonth must be a boolean");
    }
    return errors;
}
