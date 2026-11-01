import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Seeds tiered platform achievements as DRAFTS, so nothing reaches users (no XP, no notifications) until an
 * admin reviews the icons and publishes each one. Publishing runs the usual silent backfill.
 *
 * Cover icons use IGDB game ids from the dev catalog; the client falls back to a trophy when a cover is missing.
 */
type Icon =
    | { kind: "image"; name: string }
    | { kind: "game_cover"; gameId: number };
type Seed = {
    id: string;
    name: string;
    description: string;
    category: number; // 0 collections, 2 reviews, 3 comments
    metric: string;
    criteria: object;
    icon: Icon;
    thresholds: number[];
    exp: number[];
};

const image = (name: string): Icon => ({ kind: "image", name });
const cover = (gameId: number): Icon => ({ kind: "game_cover", gameId });

// Genre/theme ids are IGDB's (see game_genre / game_theme).
const FINISH = [1, 5, 15, 40];
const FINISH_EXP = [25, 50, 100, 200];
const SMALL = [1, 3, 10, 25];
const LIBRARY = [1, 5, 15, 40];
const LIBRARY_EXP = [10, 25, 50, 100];

const finished = (
    id: string,
    name: string,
    description: string,
    criteria: object,
    icon: Icon,
    thresholds = FINISH,
): Seed => ({
    id,
    name,
    description,
    category: 0,
    metric: "games_finished",
    criteria,
    icon,
    thresholds,
    exp: FINISH_EXP,
});

const library = (
    id: string,
    name: string,
    description: string,
    criteria: object,
    icon: Icon,
    thresholds = LIBRARY,
): Seed => ({
    id,
    name,
    description,
    category: 0,
    metric: "library_games",
    criteria,
    icon,
    thresholds,
    exp: LIBRARY_EXP,
});

const SEEDS: Seed[] = [
    // Milestones. Library skips 100 and followers are not repeated: space-station and take-off/crew/you-are-fireworks cover them.
    {
        id: "backlog-dragon",
        name: "Backlog Dragon",
        description: "Hoard games in your library.",
        category: 0,
        metric: "library_games",
        criteria: {},
        icon: image("backlog-dragon"),
        thresholds: [1, 10, 50, 250, 500, 1000],
        exp: [10, 25, 50, 100, 200, 400],
    },
    {
        id: "roll-credits",
        name: "Roll Credits",
        description: "Finish games in your library.",
        category: 0,
        metric: "games_finished",
        criteria: {},
        icon: image("roll-credits"),
        thresholds: [1, 5, 25, 100, 250, 500],
        exp: [15, 30, 60, 120, 250, 500],
    },
    {
        id: "critics-corner",
        name: "Critic's Corner",
        description: "Write reviews.",
        category: 2,
        metric: "reviews_written",
        criteria: {},
        icon: image("critics-corner"),
        thresholds: [1, 5, 25, 100, 250],
        exp: [20, 40, 100, 200, 400],
    },
    {
        id: "chatterbox",
        name: "Chatterbox",
        description: "Comment on reviews, posts and activities.",
        category: 3,
        metric: "comments_written",
        criteria: {},
        icon: image("chatterbox"),
        thresholds: [1, 10, 50, 250, 1000],
        exp: [10, 25, 50, 100, 250],
    },

    // Finish games by genre (12 RPG, 5 shooter, 8 platform, 9 puzzle, 10 racing, 4 fighting, 7 music, 11 RTS, 16 TBS, 24 tactical, 25 hack and slash, 34 visual novel)
    finished(
        "the-chosen-one",
        "The Chosen One",
        "Finish role-playing games.",
        { genreIds: [12] },
        cover(1942),
    ),
    finished(
        "rip-and-tear",
        "Rip and Tear",
        "Finish shooters.",
        { genreIds: [5] },
        cover(103298),
    ),
    finished(
        "climb-every-mountain",
        "Climb Every Mountain",
        "Finish platformers.",
        { genreIds: [8] },
        cover(26226),
    ),
    finished(
        "thinking-with-portals",
        "Thinking With Portals",
        "Finish puzzle games.",
        { genreIds: [9] },
        cover(72),
    ),
    finished(
        "start-your-engines",
        "Start Your Engines",
        "Finish racing games.",
        { genreIds: [10] },
        cover(141503),
    ),
    finished(
        "hadouken",
        "Hadouken!",
        "Finish fighting games.",
        { genreIds: [4] },
        cover(191692),
    ),
    finished(
        "feel-the-beat",
        "Feel the Beat",
        "Finish music games.",
        { genreIds: [7] },
        cover(233585),
        SMALL,
    ),
    finished(
        "zerg-rush",
        "Zerg Rush",
        "Finish real-time strategy games.",
        { genreIds: [11] },
        cover(239),
        SMALL,
    ),
    finished(
        "just-one-more-turn",
        "Just One More Turn",
        "Finish turn-based strategy games.",
        { genreIds: [16] },
        cover(19130),
    ),
    finished(
        "ninety-five-percent",
        "95% Chance to Hit",
        "Finish tactical games.",
        { genreIds: [24] },
        cover(10919),
    ),
    finished(
        "hack-slash-repeat",
        "Hack, Slash, Repeat",
        "Finish hack and slash games.",
        { genreIds: [25] },
        cover(113112),
    ),
    finished(
        "el-psy-kongroo",
        "El Psy Kongroo",
        "Finish visual novels.",
        { genreIds: [34] },
        cover(7194),
        SMALL,
    ),

    // Finish games by theme (19 horror, 38 open world, 18 sci-fi, 21 survival, 23 stealth, 27 comedy, 43 mystery, 22 historical)
    finished(
        "into-the-fog",
        "Into the Fog",
        "Finish horror games.",
        { themeIds: [19] },
        cover(481),
    ),
    finished(
        "off-the-beaten-path",
        "Off the Beaten Path",
        "Finish open world games.",
        { themeIds: [38] },
        cover(119133),
    ),
    finished(
        "final-frontier",
        "Final Frontier",
        "Finish science fiction games.",
        { themeIds: [18] },
        cover(11737),
    ),
    finished(
        "endure-and-survive",
        "Endure and Survive",
        "Finish survival games.",
        { themeIds: [21] },
        cover(1009),
    ),
    finished(
        "tactical-espionage",
        "Tactical Espionage Action",
        "Finish stealth games.",
        { themeIds: [23] },
        cover(375),
    ),
    finished(
        "punchline",
        "Punchline",
        "Finish comedy games.",
        { themeIds: [27] },
        cover(12517),
    ),
    finished(
        "whodunit",
        "Whodunit",
        "Finish mystery games.",
        { themeIds: [43] },
        cover(9643),
    ),
    finished(
        "time-traveler",
        "Time Traveler",
        "Finish games set in historical periods.",
        { themeIds: [22] },
        cover(127),
    ),

    // One franchise lineage: Demon's Souls, Dark Souls 1-3, Bloodborne, Sekiro, Elden Ring
    {
        id: "praise-the-sun",
        name: "Praise the Sun",
        description:
            "Finish the Souls lineage: Demon's Souls, Dark Souls I to III, Bloodborne, Sekiro and Elden Ring.",
        category: 0,
        metric: "games_finished",
        criteria: { gameIds: [5619, 2155, 2368, 11133, 7334, 76882, 119133] },
        icon: cover(2155),
        thresholds: [1, 3, 5, 7],
        exp: [50, 100, 200, 400],
    },

    // Library by genre/theme (32 indie, 33 sandbox theme, 35 card and board, 13 simulator, 33 arcade genre, 14 sport, 40 party theme)
    library(
        "hidden-gems",
        "Hidden Gems",
        "Add indie games to your library.",
        { genreIds: [32] },
        cover(14593),
        [5, 15, 40, 100],
    ),
    library(
        "creative-mode",
        "Creative Mode",
        "Add sandbox games to your library.",
        { themeIds: [33] },
        cover(135400),
    ),
    library(
        "pick-a-card",
        "Pick a Card",
        "Add card and board games to your library.",
        { genreIds: [35] },
        cover(40477),
        SMALL,
    ),
    library(
        "simulation-hypothesis",
        "Simulation Hypothesis",
        "Add simulators to your library.",
        { genreIds: [13] },
        cover(17000),
    ),
    library(
        "insert-coin",
        "Insert Coin",
        "Add arcade games to your library.",
        { genreIds: [33] },
        cover(2750),
    ),
    library(
        "what-a-save",
        "What a Save!",
        "Add sports games to your library.",
        { genreIds: [14] },
        cover(11198),
    ),
    library(
        "everyone-is-here",
        "Everyone Is Here!",
        "Add party games to your library.",
        { themeIds: [40] },
        cover(90101),
    ),
];

export class SeedTieredPlatformAchievements1794000000000
    implements MigrationInterface
{
    name = "SeedTieredPlatformAchievements1794000000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Spaced by a millisecond so the catalog keeps this order (createdAt orders definitions).
        const seededAt = Date.now();
        for (const [index, seed] of SEEDS.entries()) {
            const createdAt = new Date(seededAt + index);
            // IGNORE: an editor may already own this id, and a failure here would block the deploy.
            const inserted = await queryRunner.query(
                "INSERT IGNORE INTO achievement_definition (id, name, description, category, metric, criteria, icon, isHidden, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?)",
                [
                    seed.id,
                    seed.name,
                    seed.description,
                    seed.category,
                    seed.metric,
                    JSON.stringify(seed.criteria),
                    JSON.stringify(seed.icon),
                    createdAt,
                    createdAt,
                ],
            );
            if (inserted.affectedRows !== 1) continue;
            for (const [tier, threshold] of seed.thresholds.entries()) {
                await queryRunner.query(
                    "INSERT INTO achievement_tier (definitionId, level, threshold, expReward) VALUES (?, ?, ?, ?)",
                    [seed.id, tier + 1, threshold, seed.exp[tier]],
                );
            }
        }
    }

    /**
     * Removes only the still-draft seeds (their tiers cascade). Published ones have obtained rows and must be archived instead.
     */
    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            "DELETE FROM achievement_definition WHERE id IN (?) AND status = 'draft'",
            [SEEDS.map(({ id }) => id)],
        );
    }
}
