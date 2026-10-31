import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { AchievementDefinition } from "../../src/achievements/entities/achievement-definition.entity";
import { AchievementEvent } from "../../src/achievements/entities/achievement-event.entity";
import { AchievementStatus } from "../../src/achievements/achievements.constants";

let nextId = 900_000 + Math.floor(Math.random() * 1_000_000);

/** Minimal rows for achievement specs, on a database built by createNotificationTestDataSource. */
export function achievementFixtures(ds: DataSource) {
    return {
        async user(userId = randomUUID()) {
            await ds.query(
                "INSERT INTO profile (userId, username) VALUES (?, ?)",
                [userId, `a${userId.slice(0, 18)}`],
            );
            await ds.query("INSERT INTO library (userId) VALUES (?)", [userId]);
            return userId;
        },
        async game(themeIds: number[] = [], genreIds: number[] = []) {
            const id = nextId++;
            await ds.query(
                "INSERT INTO game (id, name, slug) VALUES (?, ?, ?)",
                [id, `Game ${id}`, `game-${id}`],
            );
            for (const themeId of themeIds) {
                await ds.query(
                    "INSERT IGNORE INTO game_theme (id) VALUES (?)",
                    [themeId],
                );
                await ds.query(
                    "INSERT INTO game_themes_game_theme (gameId, gameThemeId) VALUES (?, ?)",
                    [id, themeId],
                );
            }
            for (const genreId of genreIds) {
                await ds.query(
                    "INSERT IGNORE INTO game_genre (id) VALUES (?)",
                    [genreId],
                );
                await ds.query(
                    "INSERT INTO game_genres_game_genre (gameId, gameGenreId) VALUES (?, ?)",
                    [id, genreId],
                );
            }
            return id;
        },
        async entry(
            userId: string,
            gameId: number,
            createdAt = new Date(),
            finishedAt: Date | null = null,
        ) {
            const id = randomUUID();
            await ds.query(
                "INSERT INTO collection_entry (id, gameId, libraryUserId, createdAt, finishedAt) VALUES (?, ?, ?, ?, ?)",
                [id, gameId, userId, createdAt, finishedAt],
            );
            return id;
        },
        async review(userId: string, gameId: number, createdAt = new Date()) {
            const id = randomUUID();
            const entryId = await this.entry(userId, gameId);
            await ds.query(
                "INSERT INTO review (id, content, rating, gameId, profileUserId, collectionEntryId, createdAt) VALUES (?, 'ok', 5, ?, ?, ?, ?)",
                [id, gameId, userId, entryId, createdAt],
            );
            return id;
        },
        async follow(
            followerUserId: string,
            followedUserId: string,
            createdAt = new Date(),
        ) {
            await ds.query(
                "INSERT INTO user_follow (followerUserId, followedUserId, createdAt) VALUES (?, ?, ?)",
                [followerUserId, followedUserId, createdAt],
            );
        },
        async reviewComment(
            userId: string,
            reviewId: string,
            createdAt = new Date(),
        ) {
            await ds.query(
                "INSERT INTO review_comment (id, content, profileUserId, reviewId, createdAt) VALUES (?, 'hi', ?, ?, ?)",
                [randomUUID(), userId, reviewId, createdAt],
            );
        },
        /** Published definition with tiers given as [threshold, expReward] pairs */
        async definition(
            metric: string,
            criteria: object,
            tiers: Array<[number, number]>,
            extra: Partial<AchievementDefinition> = {},
        ) {
            const id = `t-${randomUUID().slice(0, 30)}`;
            await ds.getRepository(AchievementDefinition).save({
                id,
                name: `Name ${id}`,
                description: "Fixture",
                category: 0,
                metric,
                criteria,
                icon: { kind: "glyph", name: "star" },
                status: AchievementStatus.PUBLISHED,
                publishedAt: new Date(),
                ...extra,
                tiers: tiers.map(([threshold, expReward], index) => ({
                    definitionId: id,
                    level: index + 1,
                    threshold,
                    expReward,
                })),
            } as any);
            return ds.getRepository(AchievementDefinition).findOneOrFail({
                where: { id },
                relations: { tiers: true, event: true },
                order: { tiers: { level: "ASC" } },
            });
        },
        async event(
            startsAt: Date,
            endsAt: Date,
            status = AchievementStatus.PUBLISHED,
        ) {
            return ds.getRepository(AchievementEvent).save({
                slug: `e-${randomUUID().slice(0, 30)}`,
                name: "Fixture event",
                description: "",
                startsAt,
                endsAt,
                status,
            });
        },
        async awardsVote(userId: string, year: number) {
            await ds.query(
                "INSERT IGNORE INTO awards_event (year, votingStartDate, votingEndDate, resultsDate) VALUES (?, NOW(), NOW(), NOW())",
                [year],
            );
            const [event] = await ds.query(
                "SELECT id FROM awards_event WHERE year = ?",
                [year],
            );
            const result = await ds.query(
                "INSERT INTO awards_category (eventId, name, description) VALUES (?, 'GOTY', 'GOTY')",
                [event.id],
            );
            const gameId = await this.game();
            await ds.query(
                "INSERT INTO awards_vote (categoryId, gameId, profileUserId) VALUES (?, ?, ?)",
                [result.insertId, gameId, userId],
            );
        },
    };
}
