import { randomUUID } from "node:crypto";
import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { DailyController } from "./daily.controller";
import { DailyService } from "./daily.service";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import { addDays, dailyToday, DailyMode, DailyStatus } from "./daily.constants";
import { SessionContainer } from "../auth/session.decorator";

// Fixture puzzles use numbers from here up, so a rerun can clean them without touching anything else.
const FIXTURE_NUMBER = 900_000;
const ANSWER_ID = 1;
const WRONG_IDS = [910_001, 910_002];

describe("DailyController on MySQL", () => {
    let dataSource: DataSource;
    let controller: DailyController;
    let userId: string;
    let session: SessionContainer;
    let fixtureCount = 0;

    const cleanup = () =>
        dataSource.query("DELETE FROM daily_puzzle WHERE number >= ?", [
            FIXTURE_NUMBER,
        ]);

    const createPuzzle = (date: string, mode = DailyMode.COVER) =>
        dataSource.getRepository(DailyPuzzle).save({
            mode,
            number: FIXTURE_NUMBER + ++fixtureCount,
            date,
            gameId: ANSWER_ID,
            meta: {},
            source: "admin" as const,
        });

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await cleanup();
        for (const id of WRONG_IDS)
            await dataSource.query(
                "INSERT IGNORE INTO game (id, name, slug) VALUES (?, ?, ?)",
                [id, `Daily fixture ${id}`, `daily-fixture-${id}`],
            );
        userId = randomUUID();
        await dataSource.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [userId, `daily_${userId.slice(0, 8)}`],
        );
        session = { getUserId: () => userId } as SessionContainer;
        const service = new DailyService(
            dataSource.getRepository(DailyPuzzle),
            dataSource.getRepository(DailyResult),
            dataSource,
            { get: async () => undefined, set: async () => undefined } as any,
            { getOrThrow: () => "integration-secret" } as any,
        );
        controller = new DailyController(service);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await cleanup();
            await dataSource.destroy();
        }
    });

    it("only lets a signed-in play grow, then freezes it once finished", async () => {
        // Past dates keep fixtures out of today's (unique per mode) slot.
        const puzzle = await createPuzzle("1970-01-02");

        const first = await controller.play(
            puzzle.id,
            { guesses: [WRONG_IDS[0]] },
            session,
        );
        expect(first.status).toBe(DailyStatus.IN_PROGRESS);
        expect(first.answer).toBeUndefined();

        await expect(
            controller.play(puzzle.id, { guesses: [WRONG_IDS[1]] }, session),
        ).rejects.toThrow(BadRequestException);
        // An empty play resumes the saved progress (e.g. on another device).
        const resumed = await controller.play(
            puzzle.id,
            { guesses: [] },
            session,
        );
        expect(resumed.attempts).toBe(1);
        expect(resumed.feedback[0].gameId).toBe(WRONG_IDS[0]);

        const won = await controller.play(
            puzzle.id,
            { guesses: [WRONG_IDS[0], null, ANSWER_ID] },
            session,
        );
        expect(won.status).toBe(DailyStatus.WON);
        expect(won.answer?.id).toBe(ANSWER_ID);
        expect(won.community).toEqual({ players: 1, averageAttempts: 3 });
        expect(won.hints.imageTokens).toHaveLength(5); // levels 0..3 plus "full"

        const replay = await controller.play(
            puzzle.id,
            { guesses: [] },
            session,
        );
        expect(replay.status).toBe(DailyStatus.WON);
        expect(replay.attempts).toBe(3);

        const stored = await dataSource
            .getRepository(DailyResult)
            .findOneByOrFail({ userId, puzzleId: puzzle.id });
        expect(stored.guesses).toEqual([WRONG_IDS[0], null, ANSWER_ID]);
        expect(stored.finishedAt).not.toBeNull();
    });

    it("fixes a saved hint and never places a new one before saved guesses", async () => {
        const puzzle = await createPuzzle("1970-01-05", DailyMode.SPECS);
        const six = [...WRONG_IDS, ...WRONG_IDS, null, WRONG_IDS[0]];
        await controller.play(puzzle.id, { guesses: six }, session);

        await expect(
            controller.play(puzzle.id, { guesses: six, hintAt: 5 }, session),
        ).rejects.toThrow(BadRequestException);
        const hinted = await controller.play(
            puzzle.id,
            { guesses: six, hintAt: 6 },
            session,
        );
        expect(hinted.attempts).toBe(7);
        expect(hinted.hints.reveal).toBeDefined();

        const seven = [...six, WRONG_IDS[1]];
        for (const hintAt of [null, 7])
            await expect(
                controller.play(puzzle.id, { guesses: seven, hintAt }, session),
            ).rejects.toThrow(BadRequestException);
        const next = await controller.play(
            puzzle.id,
            { guesses: seven, hintAt: 6 },
            session,
        );
        expect(next.attempts).toBe(8);
    });

    it("hides future puzzles", async () => {
        const puzzle = await createPuzzle(addDays(dailyToday(), 400));
        await expect(
            controller.play(puzzle.id, { guesses: [] }),
        ).rejects.toThrow(NotFoundException);
    });

    it("evaluates guests without saving anything", async () => {
        const puzzle = await createPuzzle("1970-01-03");
        const result = await controller.play(puzzle.id, {
            guesses: [WRONG_IDS[0], WRONG_IDS[1]],
        });
        expect(result.status).toBe(DailyStatus.IN_PROGRESS);
        expect(result.attempts).toBe(2);
        expect(
            await dataSource
                .getRepository(DailyResult)
                .countBy({ puzzleId: puzzle.id }),
        ).toBe(0);
        await expect(
            controller.play(puzzle.id, { guesses: [999_999_999] }),
        ).rejects.toThrow(BadRequestException);
    });

    it("refuses a tampered image token", async () => {
        const puzzle = await createPuzzle("1970-01-04");
        const [token] = (await controller.play(puzzle.id, { guesses: [] }))
            .hints.imageTokens;
        const [body, signature] = token.split(".");
        const forged = `${body}.${(signature[0] === "A" ? "B" : "A") + signature.slice(1)}`;
        await expect(controller.getImage(forged, {} as any)).rejects.toThrow(
            ForbiddenException,
        );
    });
});
