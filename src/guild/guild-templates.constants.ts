import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import {
    GuildBoardCycle,
    GuildBonusObjectiveType,
    GuildCategory,
    GuildCriteria,
    GuildObjectiveType,
    GuildRank,
} from "./guild.constants";

/** A code-defined quest every board draws from (design 2). */
export interface GuildQuestTemplate {
    key: string;
    category: GuildCategory;
    cycle: GuildBoardCycle;
    rank: GuildRank;
    /** Lowest Guild rank whose boards may receive this template. */
    minRank: GuildRank;
    xpReward: number;
    sealsReward: number;
    objectiveType: GuildObjectiveType;
    targetCount: number;
    criteria: GuildCriteria;
    requiresTargetGame: boolean;
    isQuick: boolean;
    rewardKey: string | null;
    /** Days an accepted board contract stays open (design 14). */
    contractDurationDays: number;
}

/**
 * The 31 code-defined system quests: 24 weekly-pool templates across the
 * library/weekly/gamenode slots and 7 Monthly Expeditions (design 2).
 */
export const GUILD_SYSTEM_TEMPLATES: readonly GuildQuestTemplate[] = [
    // Library slot: backlog relics and procedural library-DNA quests.
    {
        key: "recent_dust",
        category: GuildCategory.LIBRARY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.E,
        xpReward: 260,
        sealsReward: 35,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 21,
    },
    {
        key: "forgotten_relic",
        category: GuildCategory.LIBRARY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.B,
        minRank: GuildRank.E,
        xpReward: 420,
        sealsReward: 60,
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
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.E,
        xpReward: 240,
        sealsReward: 35,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 21,
    },
    {
        key: "off_the_map",
        category: GuildCategory.LIBRARY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.B,
        minRank: GuildRank.D,
        xpReward: 400,
        sealsReward: 60,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 21,
    },
    {
        key: "continue_the_saga",
        category: GuildCategory.LIBRARY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.D,
        xpReward: 300,
        sealsReward: 40,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 21,
    },
    {
        key: "time_machine",
        category: GuildCategory.LIBRARY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.E,
        xpReward: 280,
        sealsReward: 35,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 21,
    },
    {
        key: "return_to_the_world",
        category: GuildCategory.LIBRARY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.D,
        xpReward: 270,
        sealsReward: 35,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 21,
    },
    {
        key: "hidden_gem",
        category: GuildCategory.LIBRARY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.D,
        xpReward: 290,
        sealsReward: 40,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 21,
    },
    // Weekly slot: gameplay, playtime and synced achievement quests.
    {
        key: "short_caravan",
        category: GuildCategory.WEEKLY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.D,
        minRank: GuildRank.E,
        xpReward: 170,
        sealsReward: 20,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: { maxTimeToBeatHours: 8 },
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    {
        key: "weekend_sprint",
        category: GuildCategory.WEEKLY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.D,
        minRank: GuildRank.E,
        xpReward: 160,
        sealsReward: 20,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    {
        key: "double_feature",
        category: GuildCategory.WEEKLY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.D,
        xpReward: 310,
        sealsReward: 40,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 2,
        criteria: {},
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 7,
    },
    {
        key: "field_vigil",
        category: GuildCategory.WEEKLY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.D,
        minRank: GuildRank.E,
        xpReward: 140,
        sealsReward: 20,
        objectiveType: GuildObjectiveType.LOG_PLAYTIME,
        targetCount: 240,
        criteria: {},
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    {
        key: "backlog_taste_test",
        category: GuildCategory.WEEKLY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.D,
        minRank: GuildRank.E,
        xpReward: 150,
        sealsReward: 20,
        objectiveType: GuildObjectiveType.LOG_PLAYTIME,
        targetCount: 2,
        criteria: { minPlaytimeSecondsPerGame: 2_700 },
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    {
        key: "campaign_rhythm",
        category: GuildCategory.WEEKLY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.D,
        minRank: GuildRank.E,
        xpReward: 150,
        sealsReward: 20,
        objectiveType: GuildObjectiveType.PLAY_DISTINCT_DAYS,
        targetCount: 4,
        criteria: {},
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    {
        key: "trophy_hunter",
        category: GuildCategory.WEEKLY,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.D,
        xpReward: 230,
        sealsReward: 35,
        objectiveType: GuildObjectiveType.EARN_GAME_ACHIEVEMENTS,
        targetCount: 10,
        criteria: {},
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 7,
    },
    // GameNode slot: reviews, Daily, collections, posts and backlog triage.
    {
        key: "captains_log",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.E,
        minRank: GuildRank.E,
        xpReward: 90,
        sealsReward: 15,
        objectiveType: GuildObjectiveType.WRITE_REVIEW,
        targetCount: 1,
        criteria: { finishedInCurrentMonth: true },
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "title_chronist",
        contractDurationDays: 7,
    },
    {
        key: "quick_take",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.E,
        minRank: GuildRank.E,
        xpReward: 70,
        sealsReward: 10,
        objectiveType: GuildObjectiveType.WRITE_REVIEW,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: null,
        contractDurationDays: 7,
    },
    {
        key: "on_duty_critic",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.D,
        minRank: GuildRank.E,
        xpReward: 150,
        sealsReward: 20,
        objectiveType: GuildObjectiveType.WRITE_REVIEW,
        targetCount: 3,
        criteria: { minReviewChars: 80 },
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    {
        key: "deep_critic",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.D,
        xpReward: 220,
        sealsReward: 35,
        objectiveType: GuildObjectiveType.WRITE_REVIEW,
        targetCount: 2,
        criteria: { minReviewChars: 200 },
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 7,
    },
    {
        key: "guild_oracle",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.E,
        minRank: GuildRank.E,
        xpReward: 90,
        sealsReward: 15,
        objectiveType: GuildObjectiveType.DAILY_CHALLENGE,
        targetCount: 3,
        criteria: {},
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    {
        key: "eagle_eye",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.C,
        minRank: GuildRank.D,
        xpReward: 230,
        sealsReward: 35,
        objectiveType: GuildObjectiveType.DAILY_CHALLENGE,
        targetCount: 2,
        criteria: { requireNoDailyHint: true, maxDailyAttempts: 3 },
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_silver",
        contractDurationDays: 7,
    },
    {
        key: "cartographer",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.E,
        minRank: GuildRank.E,
        xpReward: 85,
        sealsReward: 15,
        objectiveType: GuildObjectiveType.CURATE_COLLECTION,
        targetCount: 1,
        criteria: { minCollectionEntries: 5 },
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    {
        key: "expedition_log",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.E,
        minRank: GuildRank.E,
        xpReward: 75,
        sealsReward: 10,
        objectiveType: GuildObjectiveType.PUBLISH_POST,
        targetCount: 1,
        criteria: { minPostChars: 80 },
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: null,
        contractDurationDays: 7,
    },
    {
        key: "pack_cleanup",
        category: GuildCategory.GAMENODE,
        cycle: GuildBoardCycle.WEEKLY,
        rank: GuildRank.E,
        minRank: GuildRank.E,
        xpReward: 80,
        sealsReward: 15,
        objectiveType: GuildObjectiveType.TRIAGE_BACKLOG,
        targetCount: 3,
        criteria: {},
        requiresTargetGame: false,
        isQuick: true,
        rewardKey: "chest_bronze",
        contractDurationDays: 7,
    },
    // Monthly Expeditions: Rank A long-form quests and Rank S legendaries.
    {
        key: "the_colossus",
        category: GuildCategory.MONTHLY,
        cycle: GuildBoardCycle.MONTHLY,
        rank: GuildRank.A,
        minRank: GuildRank.C,
        xpReward: 750,
        sealsReward: 110,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: { minTimeToBeatHours: 35 },
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_gold",
        contractDurationDays: 45,
    },
    {
        key: "ancient_fossil",
        category: GuildCategory.MONTHLY,
        cycle: GuildBoardCycle.MONTHLY,
        rank: GuildRank.A,
        minRank: GuildRank.C,
        xpReward: 720,
        sealsReward: 110,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_gold",
        contractDurationDays: 45,
    },
    {
        key: "genre_marathon",
        category: GuildCategory.MONTHLY,
        cycle: GuildBoardCycle.MONTHLY,
        rank: GuildRank.A,
        minRank: GuildRank.C,
        xpReward: 780,
        sealsReward: 120,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 3,
        criteria: {},
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_gold",
        contractDurationDays: 30,
    },
    {
        key: "deep_critic_anthology",
        category: GuildCategory.MONTHLY,
        cycle: GuildBoardCycle.MONTHLY,
        rank: GuildRank.A,
        minRank: GuildRank.C,
        xpReward: 650,
        sealsReward: 100,
        objectiveType: GuildObjectiveType.WRITE_REVIEW,
        targetCount: 5,
        criteria: { minReviewChars: 250 },
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_gold",
        contractDurationDays: 30,
    },
    {
        key: "platinum_crown",
        category: GuildCategory.MONTHLY,
        cycle: GuildBoardCycle.MONTHLY,
        rank: GuildRank.S,
        minRank: GuildRank.A,
        xpReward: 1_350,
        sealsReward: 200,
        objectiveType: GuildObjectiveType.COMPLETE_GAME_100,
        targetCount: 1,
        criteria: {},
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_relic",
        contractDurationDays: 60,
    },
    {
        key: "colossus_legend",
        category: GuildCategory.MONTHLY,
        cycle: GuildBoardCycle.MONTHLY,
        rank: GuildRank.S,
        minRank: GuildRank.A,
        xpReward: 1_400,
        sealsReward: 200,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 1,
        criteria: { minTimeToBeatHours: 60 },
        requiresTargetGame: true,
        isQuick: false,
        rewardKey: "chest_relic",
        contractDurationDays: 60,
    },
    {
        key: "saga_trilogy",
        category: GuildCategory.MONTHLY,
        cycle: GuildBoardCycle.MONTHLY,
        rank: GuildRank.S,
        minRank: GuildRank.A,
        xpReward: 1_300,
        sealsReward: 200,
        objectiveType: GuildObjectiveType.FINISH_GAME,
        targetCount: 3,
        criteria: {},
        requiresTargetGame: false,
        isQuick: false,
        rewardKey: "chest_relic",
        contractDurationDays: 60,
    },
];

const ID_ARRAY_KEYS = [
    "gameIds",
    "genreIds",
    "themeIds",
    "keywordIds",
    "franchiseIds",
    "platformIds",
] as const;

const GAME_SCOPE_KEYS = [
    ...ID_ARRAY_KEYS,
    "maxTimeToBeatHours",
    "minTimeToBeatHours",
    "releaseYearMin",
    "releaseYearMax",
    "gameCategories",
    "indieOnly",
] as const;

const POSITIVE_INTEGER_KEYS = [
    "minReviewChars",
    "minPlaytimeSecondsPerGame",
    "minPostChars",
    "minCollectionEntries",
    "maxDailyAttempts",
] as const;

const BOOLEAN_KEYS = [
    "finishedInCurrentMonth",
    "indieOnly",
    "requireNoDailyHint",
] as const;

/** Criteria keys each objective understands; everything else is an admin mistake. */
const CRITERIA_KEYS: Record<GuildObjectiveType, readonly string[]> = {
    [GuildObjectiveType.FINISH_GAME]: [...GAME_SCOPE_KEYS],
    [GuildObjectiveType.WRITE_REVIEW]: [
        ...GAME_SCOPE_KEYS,
        "finishedInCurrentMonth",
        "minReviewChars",
    ],
    [GuildObjectiveType.LOG_PLAYTIME]: [
        ...GAME_SCOPE_KEYS,
        "minPlaytimeSecondsPerGame",
        "status",
    ],
    [GuildObjectiveType.PLAY_DISTINCT_DAYS]: [...GAME_SCOPE_KEYS],
    [GuildObjectiveType.DAILY_CHALLENGE]: [
        "requireNoDailyHint",
        "maxDailyAttempts",
    ],
    [GuildObjectiveType.EARN_GAME_ACHIEVEMENTS]: [...GAME_SCOPE_KEYS],
    [GuildObjectiveType.COMPLETE_GAME_100]: [...GAME_SCOPE_KEYS],
    [GuildObjectiveType.CURATE_COLLECTION]: ["minCollectionEntries"],
    [GuildObjectiveType.PUBLISH_POST]: ["minPostChars"],
    [GuildObjectiveType.TRIAGE_BACKLOG]: [],
};

const isPositiveInteger = (value: unknown): value is number =>
    Number.isInteger(value) && (value as number) > 0;

const isPositiveNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

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
        if (key === "gameCategories") {
            if (
                !Array.isArray(value) ||
                !value.every(
                    (item) => Number.isInteger(item) && (item as number) >= 0,
                )
            )
                errors.push(
                    "criteria.gameCategories must be an array of non-negative integers",
                );
            continue;
        }
        if (
            (key === "maxTimeToBeatHours" || key === "minTimeToBeatHours") &&
            !isPositiveNumber(value)
        )
            errors.push(`criteria.${key} must be a positive number`);
        if (
            (key === "releaseYearMin" || key === "releaseYearMax") &&
            !isPositiveInteger(value)
        )
            errors.push(`criteria.${key} must be a positive integer`);
        if (
            (POSITIVE_INTEGER_KEYS as readonly string[]).includes(key) &&
            !isPositiveInteger(value)
        )
            errors.push(`criteria.${key} must be a positive integer`);
        if (
            (BOOLEAN_KEYS as readonly string[]).includes(key) &&
            typeof value !== "boolean"
        )
            errors.push(`criteria.${key} must be a boolean`);
        if (
            key === "status" &&
            !Object.values(CollectionEntryStatus).includes(
                value as CollectionEntryStatus,
            )
        )
            errors.push(
                `criteria.status must be one of ${Object.values(CollectionEntryStatus).join(", ")}`,
            );
    }

    const criteriaValue = criteria as GuildCriteria;
    if (
        criteriaValue.minTimeToBeatHours != null &&
        criteriaValue.maxTimeToBeatHours != null &&
        criteriaValue.minTimeToBeatHours > criteriaValue.maxTimeToBeatHours
    )
        errors.push(
            "criteria.minTimeToBeatHours must not exceed criteria.maxTimeToBeatHours",
        );
    if (
        criteriaValue.releaseYearMin != null &&
        criteriaValue.releaseYearMax != null &&
        criteriaValue.releaseYearMin > criteriaValue.releaseYearMax
    )
        errors.push(
            "criteria.releaseYearMin must not exceed criteria.releaseYearMax",
        );

    return errors;
}

const BONUS_OBJECTIVE_TYPES: readonly GuildBonusObjectiveType[] = [
    "also_write_review",
    "finish_before_half_deadline",
    "use_stale_backlog_game",
];

const BONUS_OBJECTIVE_POSITIVE_KEYS = ["minChars", "staleDays"] as const;
const BONUS_OBJECTIVE_AMOUNT_KEYS = ["bonusXp", "bonusSeals"] as const;

/** Error messages for an optional contract bonus objective; empty when valid. */
export function validateGuildBonusObjective(value: unknown): string[] {
    if (value == null) return [];
    if (typeof value !== "object" || Array.isArray(value))
        return ["bonusObjective must be an object"];

    const objective = value as Record<string, unknown>;
    const errors: string[] = [];
    if (
        !BONUS_OBJECTIVE_TYPES.includes(
            objective.type as GuildBonusObjectiveType,
        )
    )
        errors.push(
            `bonusObjective.type must be one of ${BONUS_OBJECTIVE_TYPES.join(", ")}`,
        );

    const allowed = new Set<string>([
        "type",
        ...BONUS_OBJECTIVE_POSITIVE_KEYS,
        ...BONUS_OBJECTIVE_AMOUNT_KEYS,
        "upgradeChestTier",
    ]);
    for (const key of Object.keys(objective))
        if (!allowed.has(key))
            errors.push(`bonusObjective.${key} is not supported`);

    for (const key of BONUS_OBJECTIVE_POSITIVE_KEYS)
        if (objective[key] !== undefined && !isPositiveInteger(objective[key]))
            errors.push(`bonusObjective.${key} must be a positive integer`);
    for (const key of BONUS_OBJECTIVE_AMOUNT_KEYS)
        if (
            objective[key] !== undefined &&
            (!Number.isInteger(objective[key]) ||
                (objective[key] as number) < 0)
        )
            errors.push(`bonusObjective.${key} must be an integer >= 0`);
    if (
        objective.upgradeChestTier !== undefined &&
        typeof objective.upgradeChestTier !== "boolean"
    )
        errors.push("bonusObjective.upgradeChestTier must be a boolean");

    return errors;
}
