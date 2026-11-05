import { DailyScheduler } from "./daily.scheduler";
import { DailyMode, dailyToday } from "./daily.constants";

it("warns for empty picks and leaves existing puzzles untouched", async () => {
    const repository = {
        find: jest.fn().mockResolvedValue([{ date: dailyToday() }]),
        insert: jest.fn(),
    };
    const picker = { pick: jest.fn().mockResolvedValue(null) };
    const scheduler = new DailyScheduler(repository as any, picker as any);
    const warning = jest
        .spyOn((scheduler as any).logger, "warn")
        .mockImplementation();
    await scheduler.ensurePuzzles();
    expect(picker.pick).toHaveBeenCalledTimes(
        Object.values(DailyMode).length * 7,
    );
    expect(warning).toHaveBeenCalledTimes(Object.values(DailyMode).length * 7);
    expect(repository.insert).not.toHaveBeenCalled();
});
