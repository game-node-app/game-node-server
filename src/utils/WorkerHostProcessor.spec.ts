import { Job } from "bullmq";
import { WorkerHostProcessor } from "./WorkerHostProcessor";

class TestProcessor extends WorkerHostProcessor {
    async process() {}
}

describe("WorkerHostProcessor", () => {
    it("logs only the current failure instead of accumulated retry stacks", () => {
        const processor = new TestProcessor();
        const error = jest
            .spyOn(processor.logger, "error")
            .mockImplementation();
        const job = {
            id: "27",
            name: "track",
            queueName: "achievements-queue",
            failedReason: "db down",
            stacktrace: ["first attempt", "latest attempt"],
        } as Job;

        processor.onFailed(job);
        expect(error.mock.calls).toEqual([
            [expect.stringContaining("db down")],
            ["Stack trace: latest attempt"],
        ]);

        error.mockClear();
        const failure = new Error("current failure");
        processor.onFailed(job, failure);
        expect(error).toHaveBeenLastCalledWith(`Stack trace: ${failure.stack}`);

        error.mockRestore();
    });
});
