import "reflect-metadata";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../../test/awards/awards-test-database";
import { AwardsPlayContextService } from "./awards-play-context.service";
import { UserPlaytime } from "../../playtime/entity/user-playtime.entity";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { Review } from "../../reviews/entities/review.entity";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";

const DATABASE = "awards_play_context_test";
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const GAME_PLAYTIME = 101;
const GAME_FINISHED = 102;
const GAME_PLANNED = 103;
const GAME_DROPPED = 104;
const GAME_STARTED = 105;
const GAME_RATED = 106;
const GAME_UNKNOWN = 999;

jest.setTimeout(120000);

describe("Awards play context", () => {
    let cleanup: () => Promise<void>;
    let service: AwardsPlayContextService;

    beforeAll(async () => {
        const database = await createAwardsTestDatabase(DATABASE);
        cleanup = database.destroy;
        const source: DataSource = database.source;
        service = new AwardsPlayContextService(
            source.getRepository(UserPlaytime),
            source.getRepository(CollectionEntry),
            source.getRepository(Review),
        );

        await source.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?), (?, ?)",
            [USER_A, "context-a", USER_B, "context-b"],
        );
        await source.query("INSERT INTO library (userId) VALUES (?), (?)", [
            USER_A,
            USER_B,
        ]);
        await source.query(
            "INSERT INTO game_platform (id, name) VALUES (1, 'PC')",
        );
        await source.query(
            `INSERT INTO game (id, name, slug, firstReleaseDate) VALUES
             (?, 'Playtime', 'context-playtime', '2026-05-01 00:00:00'),
             (?, 'Finished', 'context-finished', '2026-05-01 00:00:00'),
             (?, 'Planned', 'context-planned', '2026-05-01 00:00:00'),
             (?, 'Dropped', 'context-dropped', '2026-05-01 00:00:00'),
             (?, 'Started', 'context-started', '2026-05-01 00:00:00'),
             (?, 'Rated', 'context-rated', '2026-05-01 00:00:00')`,
            [
                GAME_PLAYTIME,
                GAME_FINISHED,
                GAME_PLANNED,
                GAME_DROPPED,
                GAME_STARTED,
                GAME_RATED,
            ],
        );

        await source.query(
            `INSERT INTO user_playtime (profileUserId, gameId, source, platformId, totalPlaytimeSeconds)
             VALUES (?, ?, 'steam', 1, 309600)`,
            [USER_A, GAME_PLAYTIME],
        );

        const entries: Array<[string, number, string, Date | null]> = [
            [
                "entry-finished",
                GAME_FINISHED,
                CollectionEntryStatus.FINISHED,
                null,
            ],
            [
                "entry-planned",
                GAME_PLANNED,
                CollectionEntryStatus.PLANNED,
                null,
            ],
            [
                "entry-dropped",
                GAME_DROPPED,
                CollectionEntryStatus.DROPPED,
                null,
            ],
            [
                "entry-started",
                GAME_STARTED,
                CollectionEntryStatus.PLANNED,
                new Date("2026-03-01T00:00:00Z"),
            ],
        ];
        for (const [id, gameId, status, startedAt] of entries) {
            await source.query(
                `INSERT INTO collection_entry (id, gameId, libraryUserId, status, startedAt)
                 VALUES (?, ?, ?, ?, ?)`,
                [id, gameId, USER_A, status, startedAt],
            );
        }
        await source.query(
            `INSERT INTO collection_entry (id, gameId, libraryUserId, status)
             VALUES ('entry-b', ?, ?, ?)`,
            [GAME_RATED, USER_B, CollectionEntryStatus.PLAYING],
        );

        // A review whose collection entry belongs to someone else: the rating
        // is still the user's, but they have no library entry of their own.
        await source.query(
            `INSERT INTO review (id, content, rating, gameId, profileUserId, collectionEntryId)
             VALUES ('review-rated', 'ok', 4.5, ?, ?, 'entry-b')`,
            [GAME_RATED, USER_A],
        );
    });

    afterAll(async () => {
        await cleanup?.();
    });

    it("reads playtime-only games as played with the recorded seconds", async () => {
        const context = await service.getUserPlayContext(USER_A, [
            GAME_PLAYTIME,
        ]);

        expect(context.get(GAME_PLAYTIME)).toEqual({
            status: "played",
            playtimeSeconds: 309600,
            rating: null,
        });
    });

    it("counts finished, dropped and started entries as played without playtime", async () => {
        const context = await service.getUserPlayContext(USER_A, [
            GAME_FINISHED,
            GAME_DROPPED,
            GAME_STARTED,
        ]);

        for (const gameId of [GAME_FINISHED, GAME_DROPPED, GAME_STARTED]) {
            expect(context.get(gameId)).toEqual({
                status: "played",
                playtimeSeconds: 0,
                rating: null,
            });
        }
    });

    it("keeps a planned entry planned", async () => {
        const context = await service.getUserPlayContext(USER_A, [
            GAME_PLANNED,
        ]);

        expect(context.get(GAME_PLANNED)).toEqual({
            status: "planned",
            playtimeSeconds: 0,
            rating: null,
        });
    });

    it("returns a rating even without the user's own library entry", async () => {
        const context = await service.getUserPlayContext(USER_A, [GAME_RATED]);

        expect(context.get(GAME_RATED)).toEqual({
            status: "not_played",
            playtimeSeconds: 0,
            rating: 4.5,
        });
    });

    it("defaults unknown games to not_played", async () => {
        const context = await service.getUserPlayContext(USER_A, [
            GAME_UNKNOWN,
        ]);

        expect(context.get(GAME_UNKNOWN)).toEqual({
            status: "not_played",
            playtimeSeconds: 0,
            rating: null,
        });
        expect(await service.getUserPlayContext(USER_A, [])).toEqual(new Map());
    });
});
