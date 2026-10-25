import { Logger } from "@nestjs/common";
import {
    PlayerSyncAttempt,
    recordPlayerSyncStats,
    cancellableProviderCall,
} from "./player-sync-attempt";
import { setPlayerProviderBudget } from "./player-provider-budget.service";
import { ProviderSyncError } from "./provider-sync.error";

class SummaryFixture {
    @PlayerSyncAttempt()
    async process(job: any) {
        if (job.testOutcome !== "empty") {
            recordPlayerSyncStats({
                gamesSeen: 3,
                gamesSelected: 1,
                gamesSkipped: 2,
            });
            await cancellableProviderCall("Steam", async () => []);
        }
        if (job.testOutcome === "partial")
            recordPlayerSyncStats({ stagesFailed: 1, stagesSucceeded: 1 });
        if (["failed", "throttled", "partial"].includes(job.testOutcome))
            throw new ProviderSyncError(
                job.testOutcome === "throttled" ? "throttled" : "failed",
                "safe failure",
                {
                    Authorization: "secret-token",
                    body: "private-provider-data",
                },
            );
        recordPlayerSyncStats({
            gamesChanged: job.testOutcome === "empty" ? 0 : 1,
        });
        return { outcome: "complete" };
    }
}

it.each(["complete", "empty", "partial", "throttled", "failed"])(
    "emits a bounded, secret-free %s run summary",
    async (outcome) => {
        setPlayerProviderBudget({ run: async (_provider, work) => work() });
        const log = jest
            .spyOn(Logger.prototype, "log")
            .mockImplementation(() => undefined);
        const job = {
            testOutcome: outcome,
            data: {
                userId: "private-user",
                owner: {
                    source: "steam",
                    sourceUserId: "private-account",
                    ownerToken: "private-owner",
                },
            },
            attemptsMade: 2,
            timestamp: Date.now() - 1000,
        };
        try {
            await new SummaryFixture().process(job).catch(() => undefined);
            const summaries = log.mock.calls
                .map(([value]) => value as any)
                .filter((value) => value?.event === "player-sync-run");
            expect(summaries).toHaveLength(1);
            expect(summaries[0]).toMatchObject({
                source: "steam",
                outcome,
                retries: 2,
                providerCalls: outcome === "empty" ? 0 : 1,
                gamesSeen: outcome === "empty" ? 0 : 3,
            });
            expect(summaries[0].queueAgeMs).toBeGreaterThanOrEqual(1000);
            expect(summaries[0].durationMs).toBeGreaterThanOrEqual(0);
            expect(JSON.stringify(summaries[0])).not.toMatch(
                /private-|secret-token|Authorization|body/,
            );
            expect(
                Object.values(summaries[0]).every(
                    (value) =>
                        typeof value === "string" || typeof value === "number",
                ),
            ).toBe(true);
        } finally {
            log.mockRestore();
        }
    },
);
