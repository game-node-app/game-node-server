import { UnrecoverableError } from "bullmq";
import { NotificationsQueueProcessor } from "./notifications-queue.processor";
import {
    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
    NOTIFICATIONS_RELAY_TICK_JOB_NAME,
} from "./notifications.constants";

it("rejects legacy notification and like payloads before mutation", async () => {
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
});
