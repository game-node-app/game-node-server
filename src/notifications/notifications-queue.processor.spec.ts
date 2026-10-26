import { UnrecoverableError } from "bullmq";
import { NotificationsQueueProcessor } from "./notifications-queue.processor";
import { StatisticsQueueProcessor } from "../statistics/statistics-queue/statistics-queue.processor";
import {
    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
    NOTIFICATIONS_RELAY_TICK_JOB_NAME,
} from "./notifications.constants";

it("rejects legacy notification/like payloads before mutation and retains view/init processing", async () => {
    const projectEvent = jest.fn().mockResolvedValue(true);
    const relayTick = jest.fn().mockResolvedValue(0);
    const notifications = new NotificationsQueueProcessor(
        { projectEvent } as any,
        { relayTick } as any,
    );
    await expect(
        notifications.process({
            name: "notifications-register",
            data: { targetUserId: "forged" },
        } as any),
    ).rejects.toThrow(UnrecoverableError);
    expect(projectEvent).not.toHaveBeenCalled();
    await notifications.process({
        name: NOTIFICATIONS_RELAY_TICK_JOB_NAME,
        data: {},
    } as any);
    expect(relayTick).toHaveBeenCalledTimes(1);
    expect(projectEvent).not.toHaveBeenCalled();
    await notifications.process({
        name: NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
        data: { eventId: "event", attemptToken: "token" },
    } as any);
    expect(projectEvent).toHaveBeenCalledWith("event", "token");

    const statistics = { handleView: jest.fn(), create: jest.fn() };
    const processor = new StatisticsQueueProcessor(statistics as any);
    await expect(
        processor.process({ name: "like", data: {} } as any),
    ).rejects.toThrow(UnrecoverableError);
    await processor.process({
        name: "view",
        data: { sourceType: "game", sourceId: 1 },
    } as any);
    await processor.process({
        name: "create",
        data: { sourceType: "game", sourceId: 1 },
    } as any);
    expect(statistics.handleView).toHaveBeenCalledTimes(1);
    expect(statistics.create).toHaveBeenCalledTimes(1);
});
