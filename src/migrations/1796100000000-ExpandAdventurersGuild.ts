import { MigrationInterface, QueryRunner } from "typeorm";

interface SeedReward {
    id: string;
    key: string;
    kind: string;
    achievementId: string | null;
    inChestPool: number;
    chestBonusXp: number;
    chestBonusSeals: number;
    rarity: string;
    consumableKey: string | null;
}

const reward = (
    id: string,
    key: string,
    kind: string,
    rarity: string,
    extra: Partial<
        Pick<
            SeedReward,
            | "inChestPool"
            | "chestBonusXp"
            | "chestBonusSeals"
            | "consumableKey"
            | "achievementId"
        >
    > = {},
): SeedReward => ({
    id,
    key,
    kind,
    achievementId: extra.achievementId ?? null,
    inChestPool: extra.inChestPool ?? 0,
    chestBonusXp: extra.chestBonusXp ?? 0,
    chestBonusSeals: extra.chestBonusSeals ?? 0,
    rarity,
    consumableKey: extra.consumableKey ?? null,
});

/**
 * Tiered chests, rank promotion cosmetics, expanded rarity pools, license themes,
 * stamp styles, tavern decor, consumables and quest chain final rewards.
 */
const SEED_REWARDS: readonly SeedReward[] = [
    // Four tiered chests (design 5).
    reward(
        "c87608f5-f76e-452f-afe9-6f1d70db2361",
        "chest_bronze",
        "chest_bronze",
        "common",
        { chestBonusXp: 40, chestBonusSeals: 15 },
    ),
    reward(
        "36d97333-a950-489d-ade2-204e4333b9e4",
        "chest_silver",
        "chest_silver",
        "uncommon",
        { chestBonusXp: 75, chestBonusSeals: 30 },
    ),
    reward(
        "7dcf1cba-639b-4e68-9098-02310211120e",
        "chest_gold",
        "chest_gold",
        "rare",
        { chestBonusXp: 125, chestBonusSeals: 60 },
    ),
    reward(
        "7a97b959-e776-4391-8064-e6df7ceafb69",
        "chest_relic",
        "chest_relic",
        "legendary",
        { chestBonusXp: 200, chestBonusSeals: 120 },
    ),

    // Rank promotion packages D-S (spec: profile-and-ranks).
    reward(
        "e10564d8-2191-420b-8658-f09bbaa4e551",
        "title_guild_initiate",
        "title",
        "uncommon",
    ),
    reward(
        "62b4846c-e9e1-4ec6-aed6-76da26f71571",
        "frame_copper_compass",
        "avatar_frame",
        "uncommon",
    ),
    reward(
        "693d2510-17e8-46a1-97a2-32a4ba6a52c2",
        "title_field_scout",
        "title",
        "uncommon",
    ),
    reward(
        "d4001440-8262-4e66-81ad-e3830fb54a97",
        "decor_tavern_lantern",
        "tavern_decor",
        "rare",
    ),
    reward(
        "72c1d9a4-b3ae-4f57-9b77-b851721314fb",
        "frame_forged_steel",
        "avatar_frame",
        "epic",
    ),
    reward(
        "db3b946a-21c9-46ed-9996-0ebeb4bac6dc",
        "decor_sleeping_cat",
        "tavern_decor",
        "epic",
    ),
    reward(
        "6192fc43-9604-42d9-97d2-fa750cc04672",
        "title_master_adventurer",
        "title",
        "epic",
    ),
    reward(
        "062ef28f-1f5c-4e9a-bf2c-8c28d84280e8",
        "license_gilded_ledger",
        "license_theme",
        "legendary",
    ),
    reward(
        "a5dbdebc-e89d-43e6-8a87-3b922a61b199",
        "frame_astral_crown",
        "avatar_frame",
        "legendary",
    ),
    reward(
        "80156cda-a598-40bf-855f-df3e267f7d63",
        "title_guild_legend",
        "title",
        "legendary",
    ),

    // Common chest pool (8).
    reward(
        "86f087d1-8d77-4c1c-b2fa-7ed740ed86b8",
        "title_tavern_regular",
        "title",
        "common",
        { inChestPool: 1 },
    ),
    reward(
        "953aebbd-bb67-4002-9898-9d3536e49c39",
        "title_weekend_warrior",
        "title",
        "common",
        { inChestPool: 1 },
    ),
    reward(
        "180f352a-9deb-4c44-af00-2027587610c7",
        "title_pixel_pilgrim",
        "title",
        "common",
        { inChestPool: 1 },
    ),
    reward(
        "cdf06a70-af76-41ab-aefb-c36aa51db49c",
        "frame_wooden_badge",
        "avatar_frame",
        "common",
        { inChestPool: 1 },
    ),
    reward(
        "5b58cb2a-7300-44ee-bec3-88423406f694",
        "frame_candle_glow",
        "avatar_frame",
        "common",
        { inChestPool: 1 },
    ),
    reward(
        "1b04a40b-9d4d-4143-bea6-aac5f08e6bf2",
        "stamp_inkwell",
        "stamp_style",
        "common",
        { inChestPool: 1 },
    ),
    reward(
        "025ba654-8269-457f-a1de-d0308e7e8534",
        "license_travelers_ledger",
        "license_theme",
        "common",
        { inChestPool: 1 },
    ),
    reward(
        "f702dd73-8212-4b93-8b91-5fdc548e4f78",
        "decor_mug_of_ale",
        "tavern_decor",
        "common",
        { inChestPool: 1 },
    ),

    // Uncommon chest pool (8).
    reward(
        "03f28ff8-dcfb-471a-bd16-387ba3f56f55",
        "title_swift_scholar",
        "title",
        "uncommon",
        { inChestPool: 1 },
    ),
    reward(
        "396102fc-6d3a-4472-a4d1-e2065ab36d4c",
        "title_dungeon_cartographer",
        "title",
        "uncommon",
        { inChestPool: 1 },
    ),
    reward(
        "d8a774b0-8f43-4ab7-a893-8176b4b214f2",
        "frame_silver_laurel",
        "avatar_frame",
        "uncommon",
        { inChestPool: 1 },
    ),
    reward(
        "9194384d-d6d1-487c-8728-daa13bebc6e0",
        "frame_owl_wing",
        "avatar_frame",
        "uncommon",
        { inChestPool: 1 },
    ),
    reward(
        "39351456-2b68-4b0f-8ceb-aa88e58a2eb4",
        "stamp_silver_quill",
        "stamp_style",
        "uncommon",
        { inChestPool: 1 },
    ),
    reward(
        "6d2d4d21-8496-4c19-8778-59a6af9cb784",
        "license_mapmakers_ledger",
        "license_theme",
        "uncommon",
        { inChestPool: 1 },
    ),
    reward(
        "52edf254-d952-4121-8519-ffca0c470d5c",
        "decor_brass_astrolabe",
        "tavern_decor",
        "uncommon",
        { inChestPool: 1 },
    ),
    reward(
        "8c989cf5-980a-4510-80c4-f2feb07dedf9",
        "decor_herb_planter",
        "tavern_decor",
        "uncommon",
        { inChestPool: 1 },
    ),

    // Rare chest pool (6).
    reward(
        "be3a799e-a31d-4f21-a2c3-5eed17864327",
        "title_arcane_archivist",
        "title",
        "rare",
        { inChestPool: 1 },
    ),
    reward(
        "33f391af-2497-45e4-b65a-fb24c628c133",
        "frame_ruby_sigil",
        "avatar_frame",
        "rare",
        { inChestPool: 1 },
    ),
    reward(
        "0ee5427b-58bf-4a29-af67-3d655f859303",
        "stamp_ember_wax",
        "stamp_style",
        "rare",
        { inChestPool: 1 },
    ),
    reward(
        "9b67ae23-f0c5-4aff-ba8d-45d26c2cc033",
        "license_royal_archive",
        "license_theme",
        "rare",
        { inChestPool: 1 },
    ),
    reward(
        "ee63c44c-e4f5-42c4-82ad-0d46124ed485",
        "decor_crystal_chandelier",
        "tavern_decor",
        "rare",
        { inChestPool: 1 },
    ),
    reward(
        "5b5358f5-bfb6-49c6-930a-38b30a6faccb",
        "decor_ancient_globe",
        "tavern_decor",
        "rare",
        { inChestPool: 1 },
    ),

    // Epic chest pool (4).
    reward(
        "8ca4e25a-3771-4a0d-b841-81bc6d8d237b",
        "title_realm_warden",
        "title",
        "epic",
        { inChestPool: 1 },
    ),
    reward(
        "55792ca5-5fbc-49ba-8bf3-4147a77f1d5c",
        "frame_dragonbone",
        "avatar_frame",
        "epic",
        { inChestPool: 1 },
    ),
    reward(
        "ce39e36a-ee6f-4340-b5c0-3bfb53ddbcb7",
        "stamp_obsidian_seal",
        "stamp_style",
        "epic",
        { inChestPool: 1 },
    ),
    reward(
        "2a673b5f-eae5-49c9-827e-28d1134e5a84",
        "decor_enchanted_tapestry",
        "tavern_decor",
        "epic",
        { inChestPool: 1 },
    ),

    // Legendary chest pool (3).
    reward(
        "73a9c40d-add5-4b4e-92c2-d3b6b728e666",
        "title_lina_chosen",
        "title",
        "legendary",
        { inChestPool: 1 },
    ),
    reward(
        "01aa1ec6-b890-4959-a020-a5ffc5bf1e14",
        "frame_celestial_compass",
        "avatar_frame",
        "legendary",
        { inChestPool: 1 },
    ),
    reward(
        "c05732c9-75ff-4b89-b3bf-fc665e102650",
        "decor_golden_griffin",
        "tavern_decor",
        "legendary",
        { inChestPool: 1 },
    ),

    // Quest chain final cosmetics (design 4).
    reward(
        "63c73e14-2126-4b42-8015-b6e06f156e52",
        "title_pathfinder",
        "title",
        "rare",
    ),
    reward(
        "3519370b-fd39-4bd2-9a43-5e36b098ad01",
        "decor_compass_rose",
        "tavern_decor",
        "epic",
    ),
    reward(
        "32545073-57cf-443f-8c6a-d36c82b19f8d",
        "title_curator_prime",
        "title",
        "epic",
    ),
    reward(
        "a8ffa636-135f-49da-8088-9dd0875937e7",
        "decor_curators_shelf",
        "tavern_decor",
        "rare",
    ),
    reward(
        "0a20f229-e3dc-4538-890d-a03ea0f65c4e",
        "title_relic_warden",
        "title",
        "legendary",
    ),
    reward(
        "6b53b8b8-7abc-4761-92f5-c75c23cf0fdd",
        "decor_relic_plinth",
        "tavern_decor",
        "legendary",
    ),

    // Guild utility consumables (spec: emporium-and-economy).
    reward(
        "4819ef0d-1d51-4be2-b8b8-5a6aca6b2ee1",
        "hourglass",
        "consumable",
        "rare",
        { consumableKey: "hourglass" },
    ),
    reward(
        "10b2dfea-f65e-4990-b14e-b3b295945d00",
        "reroll_charter",
        "consumable",
        "uncommon",
        { consumableKey: "reroll_charter" },
    ),
    reward(
        "549c10e0-5843-46c8-bf34-288851d01342",
        "extra_slot_permit",
        "consumable",
        "epic",
        { consumableKey: "extra_slot_permit" },
    ),

    // Permanent Emporium shelf cosmetics.
    reward(
        "0eb5197a-820b-488d-9147-84e3ed54b83a",
        "license_obsidian_ledger",
        "license_theme",
        "epic",
    ),
    reward(
        "22859826-42cb-4dc5-a289-1be3a0ecb425",
        "license_tavern_ledger",
        "license_theme",
        "rare",
    ),
    reward(
        "5e01c72c-c656-45fe-b183-b30fb073b7a5",
        "stamp_gold_seal",
        "stamp_style",
        "epic",
    ),
    reward(
        "88f66f36-4127-4910-8248-00896a572a14",
        "stamp_royal_wax",
        "stamp_style",
        "rare",
    ),
    reward(
        "34494acb-f257-48f3-b9b7-10c99991ea58",
        "decor_oak_barrel",
        "tavern_decor",
        "uncommon",
    ),

    // Monthly rotating Emporium showcase pool.
    reward(
        "b35a5e5b-d985-4863-b548-1cd0f8340807",
        "license_autumn_ledger",
        "license_theme",
        "rare",
    ),
    reward(
        "cc357360-d263-42a4-9a21-bf30d441e12f",
        "stamp_pumpkin_wax",
        "stamp_style",
        "uncommon",
    ),
    reward(
        "9455da77-ce31-4296-9cb7-dfe08f37b9fc",
        "decor_autumn_wreath",
        "tavern_decor",
        "epic",
    ),
    reward(
        "445cb639-97ed-4bba-bdb5-fbfcc57f81d4",
        "frame_harvest_crown",
        "avatar_frame",
        "epic",
    ),
    reward(
        "131f22c0-f633-46b6-9d5a-d14c0dd7a903",
        "title_seasonal_explorer",
        "title",
        "uncommon",
    ),
    reward(
        "46b5b8c0-6344-4d05-8b0d-f3bfb44d613a",
        "decor_snowglobe",
        "tavern_decor",
        "rare",
    ),
    reward(
        "02532cca-76e4-486d-ad5b-f6bfe28d1bbe",
        "license_winter_ledger",
        "license_theme",
        "epic",
    ),
    reward(
        "8ed335a3-1a74-426a-9e80-b85b214959d7",
        "stamp_frost_seal",
        "stamp_style",
        "rare",
    ),
];

interface SeedEmporiumItem {
    id: string;
    rewardKey: string;
    priceSeals: number;
    minRank: string;
    isRotating: number;
    maxPurchasesPerMonth: number | null;
}

/** Permanent shelf plus 8 rotating items, so the monthly 6-item showcase always fills. */
const SEED_EMPORIUM_ITEMS: readonly SeedEmporiumItem[] = [
    {
        id: "f2af7e19-b835-4311-89de-88148b57c07d",
        rewardKey: "license_obsidian_ledger",
        priceSeals: 120,
        minRank: "C",
        isRotating: 0,
        maxPurchasesPerMonth: null,
    },
    {
        id: "29419e53-57f0-4a56-a104-d93cf7b52005",
        rewardKey: "license_tavern_ledger",
        priceSeals: 140,
        minRank: "B",
        isRotating: 0,
        maxPurchasesPerMonth: null,
    },
    {
        id: "d51f3a74-c2f1-48e0-bf87-23804062f552",
        rewardKey: "stamp_gold_seal",
        priceSeals: 90,
        minRank: "D",
        isRotating: 0,
        maxPurchasesPerMonth: null,
    },
    {
        id: "e3ed7083-ce0b-48a1-86a9-929d0bd29d96",
        rewardKey: "stamp_royal_wax",
        priceSeals: 70,
        minRank: "C",
        isRotating: 0,
        maxPurchasesPerMonth: null,
    },
    {
        id: "e958a693-1ec0-4148-8478-cd8d93837fce",
        rewardKey: "decor_oak_barrel",
        priceSeals: 100,
        minRank: "D",
        isRotating: 0,
        maxPurchasesPerMonth: null,
    },
    {
        id: "556f387f-728f-4c45-a54a-7e5003855e1a",
        rewardKey: "hourglass",
        priceSeals: 60,
        minRank: "E",
        isRotating: 0,
        maxPurchasesPerMonth: 5,
    },
    {
        id: "6fe3d186-6c0b-42f3-835a-1e42e54aa943",
        rewardKey: "reroll_charter",
        priceSeals: 45,
        minRank: "E",
        isRotating: 0,
        maxPurchasesPerMonth: 5,
    },
    {
        id: "4319f339-88bb-4ac8-b06c-2e78b18ba6c9",
        rewardKey: "extra_slot_permit",
        priceSeals: 80,
        minRank: "E",
        isRotating: 0,
        maxPurchasesPerMonth: 3,
    },
    {
        id: "eabc7cef-ad53-495d-a9a3-ff3b86cd4988",
        rewardKey: "license_autumn_ledger",
        priceSeals: 150,
        minRank: "C",
        isRotating: 1,
        maxPurchasesPerMonth: null,
    },
    {
        id: "db4d18ca-084b-4b44-8064-ea6cfc1af4ac",
        rewardKey: "stamp_pumpkin_wax",
        priceSeals: 80,
        minRank: "D",
        isRotating: 1,
        maxPurchasesPerMonth: null,
    },
    {
        id: "058e60eb-e0e7-4c61-bc0f-2b4fc00ac8fb",
        rewardKey: "decor_autumn_wreath",
        priceSeals: 110,
        minRank: "D",
        isRotating: 1,
        maxPurchasesPerMonth: null,
    },
    {
        id: "72cf7a96-0096-4584-80bf-40f4bd578276",
        rewardKey: "frame_harvest_crown",
        priceSeals: 160,
        minRank: "B",
        isRotating: 1,
        maxPurchasesPerMonth: null,
    },
    {
        id: "773aa82c-85d4-46a2-be94-ea9ce896b4f7",
        rewardKey: "title_seasonal_explorer",
        priceSeals: 130,
        minRank: "D",
        isRotating: 1,
        maxPurchasesPerMonth: null,
    },
    {
        id: "0d64fa45-e7d3-4d6a-80a8-e577da294728",
        rewardKey: "decor_snowglobe",
        priceSeals: 120,
        minRank: "D",
        isRotating: 1,
        maxPurchasesPerMonth: null,
    },
    {
        id: "67eec4fb-8915-4eb3-b61c-69a96770deff",
        rewardKey: "license_winter_ledger",
        priceSeals: 150,
        minRank: "C",
        isRotating: 1,
        maxPurchasesPerMonth: null,
    },
    {
        id: "8b7d517e-fd2a-470a-8b78-2e7342ec7dbf",
        rewardKey: "stamp_frost_seal",
        priceSeals: 80,
        minRank: "D",
        isRotating: 1,
        maxPurchasesPerMonth: null,
    },
];

const REWARD_IDS = new Map(SEED_REWARDS.map((item) => [item.key, item.id]));

const hasIndex = async (
    runner: QueryRunner,
    table: string,
    index: string,
): Promise<boolean> =>
    (
        await runner.query(
            `SELECT 1 FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
             LIMIT 1`,
            [table, index],
        )
    ).length > 0;

const hasConstraint = async (
    runner: QueryRunner,
    table: string,
    constraint: string,
): Promise<boolean> =>
    (
        await runner.query(
            `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
             LIMIT 1`,
            [table, constraint],
        )
    ).length > 0;

const addColumn = async (
    runner: QueryRunner,
    table: string,
    column: string,
    definition: string,
) => {
    if (!(await runner.hasColumn(table, column)))
        await runner.query(
            `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
        );
};

const dropColumn = async (
    runner: QueryRunner,
    table: string,
    column: string,
) => {
    if (await runner.hasColumn(table, column))
        await runner.query(
            `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``,
        );
};

/**
 * Expanded Adventurers Guild schema (design 1 and spec deltas).
 *
 * MySQL commits DDL implicitly, so every step checks before writing and seeds use
 * INSERT IGNORE; a retry after a partial failure finishes the rest.
 */
export class ExpandAdventurersGuild1796100000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        // New tables first: guild_contract.chainProgressId references guild_user_chain.
        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_seal_ledger\` (
            \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
            \`profileUserId\` varchar(36) NOT NULL,
            \`delta\` int NOT NULL,
            \`balanceAfter\` int unsigned NOT NULL,
            \`reason\` varchar(32) NOT NULL,
            \`referenceId\` varchar(64) NULL DEFAULT NULL,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`),
            KEY \`IDX_guild_seal_ledger_user_created\` (\`profileUserId\`, \`createdAt\`),
            CONSTRAINT \`FK_guild_seal_ledger_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_consumable_inventory\` (
            \`profileUserId\` varchar(36) NOT NULL,
            \`consumableKey\` varchar(32) NOT NULL,
            \`quantity\` int unsigned NOT NULL DEFAULT 0,
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`profileUserId\`, \`consumableKey\`),
            CONSTRAINT \`FK_guild_consumable_inventory_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_emporium_item\` (
            \`id\` varchar(36) NOT NULL,
            \`rewardId\` varchar(36) NOT NULL,
            \`priceSeals\` int unsigned NOT NULL,
            \`minRank\` varchar(4) NOT NULL DEFAULT 'E',
            \`isRotating\` tinyint NOT NULL DEFAULT 0,
            \`maxPurchasesPerMonth\` tinyint unsigned NULL DEFAULT NULL,
            \`isActive\` tinyint NOT NULL DEFAULT 1,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`),
            KEY \`IDX_guild_emporium_active_rotating\` (\`isActive\`, \`isRotating\`),
            KEY \`FK_guild_emporium_item_reward\` (\`rewardId\`),
            CONSTRAINT \`FK_guild_emporium_item_reward\` FOREIGN KEY (\`rewardId\`) REFERENCES \`guild_reward\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_emporium_purchase\` (
            \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
            \`profileUserId\` varchar(36) NOT NULL,
            \`emporiumItemId\` varchar(36) NOT NULL,
            \`monthKey\` char(7) NOT NULL,
            \`priceSeals\` int unsigned NOT NULL,
            \`purchasedAt\` datetime(6) NOT NULL,
            PRIMARY KEY (\`id\`),
            KEY \`IDX_guild_emporium_purchase_user_item_month\` (\`profileUserId\`, \`emporiumItemId\`, \`monthKey\`),
            KEY \`FK_guild_emporium_purchase_item\` (\`emporiumItemId\`),
            CONSTRAINT \`FK_guild_emporium_purchase_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_guild_emporium_purchase_item\` FOREIGN KEY (\`emporiumItemId\`) REFERENCES \`guild_emporium_item\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_passport_month\` (
            \`profileUserId\` varchar(36) NOT NULL,
            \`monthKey\` char(7) NOT NULL,
            \`completedContractsCount\` int unsigned NOT NULL DEFAULT 0,
            \`claimedMilestones\` json NOT NULL,
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`profileUserId\`, \`monthKey\`),
            CONSTRAINT \`FK_guild_passport_month_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_user_chain\` (
            \`id\` varchar(36) NOT NULL,
            \`profileUserId\` varchar(36) NOT NULL,
            \`chainKey\` varchar(64) NOT NULL,
            \`status\` varchar(16) NOT NULL DEFAULT 'in_progress',
            \`currentStageIndex\` tinyint unsigned NOT NULL DEFAULT 0,
            \`boundTargetGameId\` bigint NULL DEFAULT NULL,
            \`activeContractId\` varchar(36) NULL DEFAULT NULL,
            \`startedAt\` datetime(6) NOT NULL,
            \`completedAt\` datetime(6) NULL DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_guild_user_chain_user_chain\` (\`profileUserId\`, \`chainKey\`),
            KEY \`FK_guild_user_chain_game\` (\`boundTargetGameId\`),
            CONSTRAINT \`FK_guild_user_chain_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_guild_user_chain_game\` FOREIGN KEY (\`boundTargetGameId\`) REFERENCES \`game\` (\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_community_bounty\` (
            \`id\` varchar(36) NOT NULL,
            \`slug\` varchar(64) NOT NULL,
            \`title\` varchar(120) NOT NULL,
            \`description\` varchar(500) NOT NULL,
            \`objectiveType\` varchar(32) NOT NULL,
            \`criteria\` json NOT NULL,
            \`targetTotal\` int unsigned NOT NULL,
            \`currentTotal\` int unsigned NOT NULL DEFAULT 0,
            \`minUserContribution\` int unsigned NOT NULL DEFAULT 1,
            \`maxUserContributionCap\` int unsigned NOT NULL,
            \`milestoneRewards\` json NOT NULL,
            \`startsAt\` datetime NOT NULL,
            \`endsAt\` datetime NOT NULL,
            \`status\` varchar(16) NOT NULL DEFAULT 'draft',
            \`publishedAt\` datetime NULL DEFAULT NULL,
            \`reached100At\` datetime(6) NULL DEFAULT NULL,
            \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_guild_community_bounty_slug\` (\`slug\`),
            KEY \`IDX_guild_bounty_status_window\` (\`status\`, \`startsAt\`, \`endsAt\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_community_bounty_translation\` (
            \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
            \`bountyId\` varchar(36) NOT NULL,
            \`locale\` varchar(10) NOT NULL,
            \`title\` varchar(120) NOT NULL,
            \`description\` varchar(500) NOT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_guild_bounty_translation_bounty_locale\` (\`bountyId\`, \`locale\`),
            CONSTRAINT \`FK_guild_bounty_translation_bounty\` FOREIGN KEY (\`bountyId\`) REFERENCES \`guild_community_bounty\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_community_bounty_contribution\` (
            \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
            \`bountyId\` varchar(36) NOT NULL,
            \`profileUserId\` varchar(36) NOT NULL,
            \`sourceKey\` varchar(128) NOT NULL,
            \`units\` int unsigned NOT NULL DEFAULT 1,
            \`contributedAt\` datetime(6) NOT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`UQ_guild_bounty_contribution_bounty_user_source\` (\`bountyId\`, \`profileUserId\`, \`sourceKey\`),
            KEY \`IDX_guild_bounty_contrib_user\` (\`bountyId\`, \`profileUserId\`),
            KEY \`FK_guild_bounty_contribution_profile\` (\`profileUserId\`),
            CONSTRAINT \`FK_guild_bounty_contribution_bounty\` FOREIGN KEY (\`bountyId\`) REFERENCES \`guild_community_bounty\` (\`id\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_guild_bounty_contribution_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        await runner.query(`CREATE TABLE IF NOT EXISTS \`guild_community_bounty_claim\` (
            \`bountyId\` varchar(36) NOT NULL,
            \`profileUserId\` varchar(36) NOT NULL,
            \`claimedMilestones\` json NOT NULL,
            \`notifiedReadyAt\` datetime(6) NULL DEFAULT NULL,
            \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`bountyId\`, \`profileUserId\`),
            KEY \`FK_guild_bounty_claim_profile\` (\`profileUserId\`),
            CONSTRAINT \`FK_guild_bounty_claim_bounty\` FOREIGN KEY (\`bountyId\`) REFERENCES \`guild_community_bounty\` (\`id\`) ON DELETE CASCADE,
            CONSTRAINT \`FK_guild_bounty_claim_profile\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\` (\`userId\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

        // guild_profile: Seals, Prestige, rank reconciliation and Guild-only cosmetics.
        await addColumn(
            runner,
            "guild_profile",
            "sealsBalance",
            "int unsigned NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_profile",
            "prestigeLevel",
            "int unsigned NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_profile",
            "highestPromotedRank",
            "varchar(4) NOT NULL DEFAULT 'E'",
        );
        await addColumn(
            runner,
            "guild_profile",
            "equippedLicenseThemeKey",
            "varchar(64) NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_profile",
            "equippedStampStyleKey",
            "varchar(64) NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_profile",
            "equippedDecorKeys",
            "json NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_profile",
            "showcaseBadgeIds",
            "json NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_profile",
            "freeRerollWeekStart",
            "date NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_profile",
            "freeRerollsUsedThisWeek",
            "tinyint unsigned NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_profile",
            "freeHourglassMonthKey",
            "char(7) NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_profile",
            "extraSlotPermitWeekStart",
            "date NULL DEFAULT NULL",
        );

        // guild_reward: rarity tiers, chest Seals and consumables.
        await addColumn(
            runner,
            "guild_reward",
            "rarity",
            "varchar(16) NOT NULL DEFAULT 'common'",
        );
        await addColumn(
            runner,
            "guild_reward",
            "chestBonusSeals",
            "int unsigned NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_reward",
            "consumableKey",
            "varchar(32) NULL DEFAULT NULL",
        );

        // guild_board_entry: weekly/monthly cycles, Seals, bonus objectives, rerolls.
        await addColumn(
            runner,
            "guild_board_entry",
            "cycle",
            "varchar(16) NOT NULL DEFAULT 'weekly'",
        );
        await addColumn(
            runner,
            "guild_board_entry",
            "periodKey",
            "varchar(10) NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_board_entry",
            "sealsReward",
            "int unsigned NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_board_entry",
            "bonusObjective",
            "json NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_board_entry",
            "meta",
            "json NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_board_entry",
            "rerollCount",
            "tinyint unsigned NOT NULL DEFAULT 0",
        );

        await runner.query(
            "UPDATE `guild_board_entry` SET `cycle` = 'weekly', `periodKey` = DATE_FORMAT(`weekStart`, '%Y-%m-%d') WHERE `periodKey` IS NULL",
        );

        if (
            !(await hasIndex(
                runner,
                "guild_board_entry",
                "UQ_guild_board_entry_user_cycle_period_slot",
            ))
        )
            await runner.query(
                "ALTER TABLE `guild_board_entry` ADD UNIQUE KEY `UQ_guild_board_entry_user_cycle_period_slot` (`profileUserId`, `cycle`, `periodKey`, `slotIndex`)",
            );
        // The new unique key leads with profileUserId, so FK_guild_board_entry_profile
        // can switch to it before the old week/slot key is dropped.
        if (
            await hasIndex(
                runner,
                "guild_board_entry",
                "UQ_guild_board_entry_user_week_slot",
            )
        )
            await runner.query(
                "ALTER TABLE `guild_board_entry` DROP INDEX `UQ_guild_board_entry_user_week_slot`",
            );

        // guild_contract: Seals, bonus objectives, Hourglass extensions, quest chains.
        await addColumn(
            runner,
            "guild_contract",
            "sealsReward",
            "int unsigned NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_contract",
            "bonusObjective",
            "json NULL DEFAULT NULL",
        );
        await addColumn(
            runner,
            "guild_contract",
            "bonusCompleted",
            "tinyint NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_contract",
            "extendedCount",
            "tinyint unsigned NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_contract",
            "chainProgressId",
            "varchar(36) NULL DEFAULT NULL",
        );
        if (
            !(await hasIndex(
                runner,
                "guild_contract",
                "IDX_guild_contract_chain_progress",
            ))
        )
            await runner.query(
                "ALTER TABLE `guild_contract` ADD KEY `IDX_guild_contract_chain_progress` (`chainProgressId`)",
            );
        if (
            !(await hasConstraint(
                runner,
                "guild_contract",
                "FK_guild_contract_chain_progress",
            ))
        )
            await runner.query(
                "ALTER TABLE `guild_contract` ADD CONSTRAINT `FK_guild_contract_chain_progress` FOREIGN KEY (`chainProgressId`) REFERENCES `guild_user_chain` (`id`) ON DELETE SET NULL",
            );

        // guild_event: Seals and bonus objectives on curated events.
        await addColumn(
            runner,
            "guild_event",
            "sealsReward",
            "int unsigned NOT NULL DEFAULT 0",
        );
        await addColumn(
            runner,
            "guild_event",
            "bonusObjective",
            "json NULL DEFAULT NULL",
        );

        // Legacy weekly_chest becomes the Silver-equivalent chest (design 5).
        await runner.query(
            "UPDATE `guild_reward` SET `chestBonusSeals` = 30, `rarity` = 'uncommon' WHERE `key` = 'weekly_chest' AND `chestBonusSeals` = 0",
        );

        for (const item of SEED_REWARDS)
            await runner.query(
                "INSERT IGNORE INTO `guild_reward` (`id`, `key`, `kind`, `achievementId`, `inChestPool`, `chestBonusXp`, `chestBonusSeals`, `rarity`, `consumableKey`, `isActive`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
                [
                    item.id,
                    item.key,
                    item.kind,
                    item.achievementId,
                    item.inChestPool,
                    item.chestBonusXp,
                    item.chestBonusSeals,
                    item.rarity,
                    item.consumableKey,
                ],
            );

        for (const item of SEED_EMPORIUM_ITEMS)
            await runner.query(
                "INSERT IGNORE INTO `guild_emporium_item` (`id`, `rewardId`, `priceSeals`, `minRank`, `isRotating`, `maxPurchasesPerMonth`, `isActive`) VALUES (?, ?, ?, ?, ?, ?, 1)",
                [
                    item.id,
                    REWARD_IDS.get(item.rewardKey),
                    item.priceSeals,
                    item.minRank,
                    item.isRotating,
                    item.maxPurchasesPerMonth,
                ],
            );
    }

    async down(runner: QueryRunner): Promise<void> {
        // Monthly expeditions cannot coexist with the old weekly unique key.
        if (await runner.hasColumn("guild_board_entry", "cycle"))
            await runner.query(
                "DELETE FROM `guild_board_entry` WHERE `cycle` = 'monthly'",
            );

        if (
            await hasConstraint(
                runner,
                "guild_contract",
                "FK_guild_contract_chain_progress",
            )
        )
            await runner.query(
                "ALTER TABLE `guild_contract` DROP FOREIGN KEY `FK_guild_contract_chain_progress`",
            );
        if (
            await hasIndex(
                runner,
                "guild_contract",
                "IDX_guild_contract_chain_progress",
            )
        )
            await runner.query(
                "ALTER TABLE `guild_contract` DROP INDEX `IDX_guild_contract_chain_progress`",
            );
        await dropColumn(runner, "guild_contract", "chainProgressId");
        await dropColumn(runner, "guild_contract", "extendedCount");
        await dropColumn(runner, "guild_contract", "bonusCompleted");
        await dropColumn(runner, "guild_contract", "bonusObjective");
        await dropColumn(runner, "guild_contract", "sealsReward");

        await dropColumn(runner, "guild_event", "bonusObjective");
        await dropColumn(runner, "guild_event", "sealsReward");

        if (
            !(await hasIndex(
                runner,
                "guild_board_entry",
                "UQ_guild_board_entry_user_week_slot",
            ))
        )
            await runner.query(
                "ALTER TABLE `guild_board_entry` ADD UNIQUE KEY `UQ_guild_board_entry_user_week_slot` (`profileUserId`, `weekStart`, `slotIndex`)",
            );
        // Drop the new key only after the restored week/slot key can support the profile FK.
        if (
            await hasIndex(
                runner,
                "guild_board_entry",
                "UQ_guild_board_entry_user_cycle_period_slot",
            )
        )
            await runner.query(
                "ALTER TABLE `guild_board_entry` DROP INDEX `UQ_guild_board_entry_user_cycle_period_slot`",
            );
        await dropColumn(runner, "guild_board_entry", "rerollCount");
        await dropColumn(runner, "guild_board_entry", "meta");
        await dropColumn(runner, "guild_board_entry", "bonusObjective");
        await dropColumn(runner, "guild_board_entry", "sealsReward");
        await dropColumn(runner, "guild_board_entry", "periodKey");
        await dropColumn(runner, "guild_board_entry", "cycle");

        await dropColumn(runner, "guild_reward", "consumableKey");
        await dropColumn(runner, "guild_reward", "chestBonusSeals");
        await dropColumn(runner, "guild_reward", "rarity");

        await dropColumn(runner, "guild_profile", "extraSlotPermitWeekStart");
        await dropColumn(runner, "guild_profile", "freeHourglassMonthKey");
        await dropColumn(runner, "guild_profile", "freeRerollsUsedThisWeek");
        await dropColumn(runner, "guild_profile", "freeRerollWeekStart");
        await dropColumn(runner, "guild_profile", "showcaseBadgeIds");
        await dropColumn(runner, "guild_profile", "equippedDecorKeys");
        await dropColumn(runner, "guild_profile", "equippedStampStyleKey");
        await dropColumn(runner, "guild_profile", "equippedLicenseThemeKey");
        await dropColumn(runner, "guild_profile", "highestPromotedRank");
        await dropColumn(runner, "guild_profile", "prestigeLevel");
        await dropColumn(runner, "guild_profile", "sealsBalance");

        // Child tables first so the foreign keys never block a drop.
        await runner.query(
            "DROP TABLE IF EXISTS `guild_community_bounty_claim`",
        );
        await runner.query(
            "DROP TABLE IF EXISTS `guild_community_bounty_contribution`",
        );
        await runner.query(
            "DROP TABLE IF EXISTS `guild_community_bounty_translation`",
        );
        await runner.query("DROP TABLE IF EXISTS `guild_community_bounty`");
        await runner.query("DROP TABLE IF EXISTS `guild_emporium_purchase`");
        await runner.query("DROP TABLE IF EXISTS `guild_emporium_item`");
        await runner.query("DROP TABLE IF EXISTS `guild_passport_month`");
        await runner.query("DROP TABLE IF EXISTS `guild_user_chain`");
        await runner.query("DROP TABLE IF EXISTS `guild_consumable_inventory`");
        await runner.query("DROP TABLE IF EXISTS `guild_seal_ledger`");

        // Keep a reward a member already unlocked: user_guild_reward cascades on delete.
        for (const item of SEED_REWARDS)
            await runner.query(
                "DELETE r FROM `guild_reward` r WHERE r.`key` = ? AND NOT EXISTS (SELECT 1 FROM `user_guild_reward` u WHERE u.`rewardId` = r.`id`)",
                [item.key],
            );
    }
}
