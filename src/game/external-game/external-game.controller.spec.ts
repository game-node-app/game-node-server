import { ExternalGameController } from "./external-game.controller";
import { EUserRoles } from "../../utils/constants";

describe("ExternalGameController.fillEpicNamespaces", () => {
    it("is restricted to admins", () => {
        const roles = Reflect.getMetadata(
            "roles",
            ExternalGameController.prototype.fillEpicNamespaces,
        );
        expect(roles).toEqual([EUserRoles.ADMIN.valueOf()]);
    });

    it("adds the job under a fixed id and reports an existing run instead of starting another", async () => {
        const getState = jest
            .fn()
            .mockResolvedValueOnce("waiting")
            .mockResolvedValueOnce("active");
        // BullMQ returns the existing job when the jobId is already queued or active.
        const add = jest.fn().mockResolvedValue({
            id: "epic-namespace-fill",
            getState,
        });
        const controller = new ExternalGameController(
            {} as any,
            {
                add,
            } as any,
        );

        await expect(controller.fillEpicNamespaces()).resolves.toEqual({
            jobId: "epic-namespace-fill",
            state: "waiting",
        });
        await expect(controller.fillEpicNamespaces()).resolves.toEqual({
            jobId: "epic-namespace-fill",
            state: "active",
        });
        expect(add).toHaveBeenNthCalledWith(
            1,
            "epic-namespace-fill",
            {},
            expect.objectContaining({
                jobId: "epic-namespace-fill",
                removeOnComplete: true,
                removeOnFail: true,
            }),
        );
    });
});
