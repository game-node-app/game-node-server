import { UnrecoverableError } from "bullmq";
import { NotificationsQueueProcessor } from "./notifications-queue.processor";
import { StatisticsQueueProcessor } from "../statistics/statistics-queue/statistics-queue.processor";

it("rejects legacy notification/like payloads before mutation and retains view/init processing", async () => {
    const projectEvent = jest.fn().mockResolvedValue(true);
    const notifications = new NotificationsQueueProcessor({
        projectEvent,
    } as any);
    await expect(
        notifications.process({
            name: "notifications-register",
            data: { targetUserId: "forged" },
        } as any),
    ).rejects.toThrow(UnrecoverableError);
    expect(projectEvent).not.toHaveBeenCalled();
    await notifications.process({
        name: "notifications-process-outbox",
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
