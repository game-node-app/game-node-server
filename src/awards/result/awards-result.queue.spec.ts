import "reflect-metadata";
import {
    AwardsResultQueue,
    AWARDS_RESULT_SCHEDULER_ID,
    AWARDS_RESULT_SCHEDULER_PATTERN,
} from "./awards-result.queue";

describe("AwardsResultQueue", () => {
    it("upserts the hourly lifecycle tick under the existing scheduler id", async () => {
        const upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
        new AwardsResultQueue({
            upsertJobScheduler,
        } as unknown as ConstructorParameters<typeof AwardsResultQueue>[0]);
        await new Promise((resolve) => setImmediate(resolve));

        expect(upsertJobScheduler).toHaveBeenCalledTimes(1);
        expect(upsertJobScheduler).toHaveBeenCalledWith(
            AWARDS_RESULT_SCHEDULER_ID,
            { pattern: AWARDS_RESULT_SCHEDULER_PATTERN },
        );
        expect(AWARDS_RESULT_SCHEDULER_ID).toBe("awards-result-scheduler");
        expect(AWARDS_RESULT_SCHEDULER_PATTERN).toBe("0 * * * *");
    });
});
