import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { DailyService } from "./daily.service";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import {
    addDays,
    dailyToday,
    DailyMode,
    DailyPuzzleKind,
    DailyStatus,
} from "./daily.constants";

// Fixture numbers stay below the controller spec's 900000 range so its cleanup can't delete them.
const FIXTURE_NUMBER = 870_000;
const ANSWER_ID = 1;
const WRONG_ID = 870_001;

describe("DailyService counted results on MySQL", () => {
    const today = dailyToday();
    let dataSource: DataSource;
    let service: DailyService;
    let userId: string;
    let importedUserId: string;
    let fixtureCount = 0;
    let sameDayPuzzle: DailyPuzzle;

    const cleanup = () =>
        dataSource.query(
            "DELETE FROM daily_puzzle WHERE number >= ? AND number < 900000",
            [FIXTURE_NUMBER],
        );

    const createPuzzle = (
        date: string,
        mode = DailyMode.COVER,
        kind: DailyPuzzleKind = "daily",
    ) =>
        dataSource.getRepository(DailyPuzzle).save({
            kind,
            mode,
            number: FIXTURE_NUMBER + ++fixtureCount,
            date,
            gameId: ANSWER_ID,
            meta: {},
            source: "admin" as const,
        });

    const stored = (puzzleId: number, id = userId) =>
        dataSource
            .getRepository(DailyResult)
            .findOneByOrFail({ userId: id, puzzleId });

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await cleanup();
        await dataSource.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (?, ?, ?)",
            [
                WRONG_ID,
                "Daily service fixture",
                `daily-service-fixture-${WRONG_ID}`,
            ],
        );
        userId = randomUUID();
        importedUserId = randomUUID();
        for (const id of [userId, importedUserId])
            await dataSource.query(
                "INSERT INTO profile (userId, username) VALUES (?, ?)",
                [id, `daily_${id.slice(0, 8)}`],
            );
        service = new DailyService(
            dataSource.getRepository(DailyPuzzle),
            dataSource.getRepository(DailyResult),
            dataSource,
            { get: async () => undefined, set: async () => undefined } as any,
            { getOrThrow: () => "integration-secret" } as any,
            {
                weeklyEntry: async () => null,
                summaryAfterPlay: async () => undefined,
                recompute: async () => undefined,
            } as any,
        );
        sameDayPuzzle = await createPuzzle(today, DailyMode.ARTWORK);
    }, 120000);

    afterAll(async () => {
        if (!dataSource?.isInitialized) return;
        await cleanup();
        await dataSource.query("DELETE FROM profile WHERE userId IN (?, ?)", [
            userId,
            importedUserId,
        ]);
        await dataSource.destroy();
    });

    it("counts a same-day daily finish once, even after a reopen", async () => {
        const won = await service.play(userId, sameDayPuzzle.id, {
            guesses: [WRONG_ID, ANSWER_ID],
        });
        expect(won.status).toBe(DailyStatus.WON);
        expect(won.attempts).toBe(2);

        let result = await stored(sameDayPuzzle.id);
        expect(result.ranked).toBe(true);
        expect(result.points).toBe(50); // 10 * (7 - 2) in tenths
        const finishedAt = result.finishedAt;

        await service.play(userId, sameDayPuzzle.id, { guesses: [] });
        result = await stored(sameDayPuzzle.id);
        expect(result.ranked).toBe(true);
        expect(result.points).toBe(50);
        expect(result.attempts).toBe(2);
        expect(result.finishedAt).toEqual(finishedAt);
    });

    it("does not count a daily finish after midnight", async () => {
        const puzzle = await createPuzzle(addDays(today, -1), DailyMode.COVER);
        await service.play(userId, puzzle.id, { guesses: [ANSWER_ID] });

        const result = await stored(puzzle.id);
        expect(result.status).toBe(DailyStatus.WON);
        expect(result.ranked).toBe(false);
        expect(result.points).toBe(0);
    });

    it("does not count an archive finish", async () => {
        const puzzle = await createPuzzle("1980-01-11", DailyMode.COVER);
        await service.play(userId, puzzle.id, { guesses: [ANSWER_ID] });

        const result = await stored(puzzle.id);
        expect(result.status).toBe(DailyStatus.WON);
        expect(result.ranked).toBe(false);
        expect(result.points).toBe(0);
    });

    it("evaluates a guest without saving a result", async () => {
        const puzzle = await createPuzzle("1980-02-02", DailyMode.COVER);
        const result = await service.play(undefined, puzzle.id, {
            guesses: [ANSWER_ID],
        });
        expect(result.status).toBe(DailyStatus.WON);
        expect(
            await dataSource
                .getRepository(DailyResult)
                .countBy({ puzzleId: puzzle.id }),
        ).toBe(0);
    });

    it("never counts an imported result, even on the puzzle day", async () => {
        const imported = await service.importResults(importedUserId, {
            results: [{ puzzleId: sameDayPuzzle.id, guesses: [ANSWER_ID] }],
        });
        expect(imported).toEqual({ imported: 1 });

        const result = await stored(sameDayPuzzle.id, importedUserId);
        expect(result.status).toBe(DailyStatus.WON);
        expect(result.ranked).toBe(false);
        expect(result.points).toBe(0);
    });

    it("counts a weekly finish inside its week without points", async () => {
        const puzzle = await createPuzzle(
            addDays(today, -6),
            DailyMode.SPECS,
            "weekly",
        );
        await service.play(userId, puzzle.id, { guesses: [ANSWER_ID] });

        const result = await stored(puzzle.id);
        expect(result.status).toBe(DailyStatus.WON);
        expect(result.ranked).toBe(true);
        expect(result.points).toBe(0);
    });

    it("does not count a weekly finish after its week", async () => {
        const puzzle = await createPuzzle(
            addDays(today, -7),
            DailyMode.SPECS,
            "weekly",
        );
        await service.play(userId, puzzle.id, { guesses: [ANSWER_ID] });

        const result = await stored(puzzle.id);
        expect(result.status).toBe(DailyStatus.WON);
        expect(result.ranked).toBe(false);
        expect(result.points).toBe(0);
    });
});
