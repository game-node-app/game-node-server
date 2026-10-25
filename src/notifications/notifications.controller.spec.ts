import { NotificationsController } from "./notifications.controller";

test("notification view updates use the session owner", async () => {
    const updateViewedStatus = jest.fn();
    const controller = new NotificationsController({
        updateViewedStatus,
    } as any);
    const dto = { notificationIds: [1, 2], isViewed: true };
    await controller.updateViewedStatus(
        { getUserId: () => "owner" } as any,
        dto,
    );
    expect(updateViewedStatus).toHaveBeenCalledWith("owner", dto);
});
