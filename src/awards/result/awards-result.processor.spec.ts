import "reflect-metadata";
import { AwardsResultProcessor } from "./awards-result.processor";
import { NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK } from "../../notifications/notification-campaign.service";
import { AwardsEvent } from "../entity/awards-event.entity";
import { AwardsService } from "../awards.service";
import { AwardsResultService } from "./awards-result.service";
import { AwardsNominationService } from "../nomination/awards-nomination.service";
import { NotificationCampaignService } from "../../notifications/notification-campaign.service";
import { DataSource } from "typeorm";

const NOW = new Date("2026-12-02T12:00:00Z");

const event = (year: number) =>
    ({
        id: year,
        year,
        votingStartDate: new Date("2026-12-01T00:00:00Z"),
        votingEndDate: new Date("2026-12-20T00:00:00Z"),
        resultsDate: new Date("2026-12-27T00:00:00Z"),
        nominationStartDate: null,
        nominationEndDate: null,
    }) as AwardsEvent;

function build(
    events: AwardsEvent[],
    batchesPerCall: number[],
    pendingGoal: boolean,
) {
    const runCampaign = jest.fn().mockImplementation(async () => ({
        completed: false,
        sent: 0,
        batches: batchesPerCall.shift() ?? 1,
    }));
    const dataSource = {
        query: jest.fn().mockResolvedValue(pendingGoal ? [{ 1: 1 }] : []),
    };
    const processor = new AwardsResultProcessor(
        {
            getEventsInLifecycleWindow: jest.fn().mockResolvedValue(events),
        } as unknown as AwardsService,
        {
            eventHasResults: jest.fn().mockResolvedValue(false),
        } as unknown as AwardsResultService,
        {
            finalizeNominees: jest.fn().mockResolvedValue(undefined),
        } as unknown as AwardsNominationService,
        { runCampaign } as unknown as NotificationCampaignService,
        dataSource as unknown as DataSource,
    );
    return { processor, runCampaign, dataSource };
}

describe("AwardsResultProcessor campaign budget", () => {
    it("shares one 20-batch budget across every campaign of the tick", async () => {
        expect(NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK).toBe(20);
        const { processor, runCampaign } = build(
            [event(2030), event(2031)],
            [8, 12],
            true,
        );

        await processor.runTick(NOW);

        expect(runCampaign).toHaveBeenCalledTimes(2);
        expect(runCampaign.mock.calls[0][1]).toEqual({ maxBatches: 20 });
        expect(runCampaign.mock.calls[1][1]).toEqual({ maxBatches: 12 });
        expect((runCampaign.mock.calls[0][0] as { key: string }).key).toBe(
            "awards:2030:voting_open",
        );
        expect((runCampaign.mock.calls[1][0] as { key: string }).key).toBe(
            "awards:2031:voting_open",
        );
    });

    it("resumes the pending goal campaign when no event is active", async () => {
        const { processor, runCampaign } = build([], [1], true);

        await processor.runTick(new Date("2027-07-01T13:00:00Z"));

        expect(runCampaign).toHaveBeenCalledTimes(1);
        expect(runCampaign).toHaveBeenCalledWith(
            {
                key: "goal:2027:july",
                eventType: "goal.reminder",
                payload: { year: 2027 },
            },
            { maxBatches: 20 },
        );
    });

    it("does nothing when there is no active event and no pending campaign", async () => {
        const { processor, runCampaign } = build([], [], false);

        await processor.runTick(new Date("2027-07-01T13:00:00Z"));

        expect(runCampaign).not.toHaveBeenCalled();
    });
});
