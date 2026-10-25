import { NotificationsQueueService } from "./notifications-queue.service";
import {
    ENotificationCategory,
    NotificationSourceType,
    NOTIFICATIONS_REGISTER_JOB_NAME,
} from "./notifications.constants";

test("importer enqueue awaits Redis and uses a retained source identity", async () => {
    const add = jest.fn().mockResolvedValue({ id: "job" });
    const service = new NotificationsQueueService({ add } as any);
    const dto = {
        targetUserId: "owner",
        userId: undefined,
        category: ENotificationCategory.WATCH,
        sourceType: NotificationSourceType.IMPORTER,
        sourceId: 7,
    };
    await expect(service.registerImporterNotification(dto)).resolves.toEqual({
        id: "job",
    });
    expect(add).toHaveBeenCalledWith(NOTIFICATIONS_REGISTER_JOB_NAME, dto, {
        jobId: "importer-notification-7",
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 604800, count: 1000 },
    });
    add.mockRejectedValueOnce(new Error("Redis unavailable"));
    await expect(service.registerImporterNotification(dto)).rejects.toThrow(
        "Redis unavailable",
    );
});
