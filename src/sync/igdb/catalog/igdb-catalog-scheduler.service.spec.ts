import { Queue } from "bullmq";
import { IgdbCatalogSchedulerService } from "./igdb-catalog-scheduler.service";
import { IgdbCatalogStateService } from "./igdb-catalog-state.service";
import { catalogConfig } from "./igdb-catalog.config";

function setup(days = 7) {
    const state = {
        status: "completed",
        runId: "old",
        nextEligibleAt: new Date(days * 86400000),
        leaseExpiresAt: null as Date | null,
    };
    let claimable = true;
    const service = {
        readStatus: jest.fn(async () => ({ ...state })),
        claimRun: jest.fn(async () => {
            if (
                !claimable ||
                (state.nextEligibleAt &&
                    Date.now() < state.nextEligibleAt.getTime())
            )
                return null;
            claimable = false;
            state.status = "running";
            state.runId = "new";
            return { ...state };
        }),
        releaseOwnership: jest.fn(async () => {
            claimable = true;
        }),
    };
    const jobs = new Map<string, any>();
    const queue = {
        getJob: jest.fn(async (id: string) => jobs.get(id)),
        add: jest.fn(
            async (name: string, data: unknown, options: { jobId: string }) => {
                if (!jobs.has(options.jobId))
                    jobs.set(options.jobId, {
                        getState: async () => "waiting",
                    });
                return { name, data };
            },
        ),
    };
    const config = { ...catalogConfig({}), intervalDays: days };
    const make = () =>
        new IgdbCatalogSchedulerService(
            service as unknown as IgdbCatalogStateService,
            queue as unknown as Queue,
            config,
        );
    return { state, service, queue, config, jobs, make };
}

describe("catalog scheduler", () => {
    it.each([7, 14])(
        "respects the %i-day UTC completion cooldown and deduplicates ticks",
        async (days) => {
            const clock = jest
                .spyOn(Date, "now")
                .mockReturnValue(days * 86400000 - 1);
            const f = setup(days);
            const scheduler = f.make();
            try {
                await scheduler.reconcile();
                expect(f.queue.add).not.toHaveBeenCalled();
                clock.mockReturnValue(days * 86400000);
                await scheduler.reconcile();
                await Promise.all([
                    scheduler.reconcile(),
                    f.make().reconcile(),
                ]);
                expect(f.queue.add).toHaveBeenCalledTimes(1);
                expect(f.jobs.size).toBe(1);
            } finally {
                clock.mockRestore();
            }
        },
    );
    it("starts eligible work immediately and leaves paused work alone", async () => {
        const f = setup();
        f.state.status = "idle";
        f.state.nextEligibleAt = new Date(0);
        await f.make().onModuleInit();
        expect(f.queue.add).toHaveBeenCalledTimes(1);
        f.state.status = "paused";
        await f.make().reconcile();
        expect(f.queue.add).toHaveBeenCalledTimes(1);
        f.state.status = "idle";
        await f.make().reconcile();
        expect(f.queue.add).toHaveBeenCalledTimes(1);
    });
    it("reuses active/waiting work and retries a retained terminal job for the same interrupted run", async () => {
        const f = setup();
        f.state.status = "running";
        f.state.runId = "new";
        f.state.nextEligibleAt = new Date(0);
        const retry = jest.fn().mockResolvedValue(undefined);
        let jobState = "active";
        f.jobs.set("igdb-catalog-new", {
            getState: async () => jobState,
            retry,
        });
        await f.make().reconcile();
        expect(f.service.claimRun).not.toHaveBeenCalled();
        jobState = "failed";
        await f.make().reconcile();
        expect(retry).toHaveBeenCalledWith("failed");
        expect(f.queue.add).not.toHaveBeenCalled();
    });
});
