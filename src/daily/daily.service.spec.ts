import { DailyService } from "./daily.service";
import { DailyMode, DailyStatus, dailyToday } from "./daily.constants";

function fixture(status: DailyStatus) {
    const puzzle = {
        id: 1,
        number: 1,
        date: dailyToday(),
        kind: "daily",
        mode: DailyMode.COVER,
        gameId: 10,
        meta: {},
    };
    const manager = {
        query: jest.fn().mockResolvedValue([]),
        getRepository: jest.fn(() => ({
            findOneBy: jest.fn().mockResolvedValue(null),
            upsert: jest.fn(),
        })),
    };
    const dataSource = {
        transaction: jest.fn(async (action: (manager: unknown) => unknown) =>
            action(manager),
        ),
    };
    const ranking = {
        recompute: jest.fn(),
        summaryAfterPlay: jest.fn(),
        weeklyEntry: jest.fn(),
    };
    const guildQueue = { enqueueEvaluation: jest.fn() };
    const service = new DailyService(
        { findOneBy: jest.fn().mockResolvedValue(puzzle) } as any,
        { findOneBy: jest.fn().mockResolvedValue(null) } as any,
        dataSource as any,
        {} as any,
        { getOrThrow: () => "secret" } as any,
        ranking as any,
        guildQueue as any,
    );
    jest.spyOn(service as any, "evaluate").mockResolvedValue({
        status,
        attempts: 1,
    });
    jest.spyOn(service as any, "rankingSummary").mockResolvedValue(undefined);
    jest.spyOn(service as any, "toPlayResponse").mockResolvedValue({
        ok: true,
    });
    return { service, guildQueue, dataSource };
}

const play = (service: DailyService) =>
    service.play("user", 1, { guesses: [10] } as any);

describe("DailyService guild contract evaluation hook", () => {
    it("schedules evaluation after a winning Daily finish commits", async () => {
        const { service, guildQueue, dataSource } = fixture(DailyStatus.WON);

        await play(service);

        expect(guildQueue.enqueueEvaluation).toHaveBeenCalledWith(
            "user",
            "daily",
        );
        expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
            guildQueue.enqueueEvaluation.mock.invocationCallOrder[0],
        );
    });

    it("does not schedule evaluation for a lost Daily finish", async () => {
        const { service, guildQueue } = fixture(DailyStatus.LOST);

        await play(service);

        expect(guildQueue.enqueueEvaluation).not.toHaveBeenCalled();
    });

    it("does not schedule evaluation when the Daily transaction rolls back", async () => {
        const { service, guildQueue, dataSource } = fixture(DailyStatus.WON);
        const failure = new Error("deadlock");
        dataSource.transaction.mockRejectedValue(failure);

        await expect(play(service)).rejects.toBe(failure);
        expect(guildQueue.enqueueEvaluation).not.toHaveBeenCalled();
    });

    it("does not wait for the evaluation queue before answering", async () => {
        const { service, guildQueue } = fixture(DailyStatus.WON);
        guildQueue.enqueueEvaluation.mockReturnValue(new Promise(() => {}));

        await expect(play(service)).resolves.toEqual({ ok: true });
        expect(guildQueue.enqueueEvaluation).toHaveBeenCalledTimes(1);
    });
});
