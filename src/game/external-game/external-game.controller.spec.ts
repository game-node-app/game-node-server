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

describe("ExternalGameController unmapped endpoints", () => {
    it.each(["findUnmappedEntries", "dismissUnmappedEntry"] as const)(
        "%s is restricted to moderators and admins",
        (method) => {
            expect(
                Reflect.getMetadata(
                    "roles",
                    ExternalGameController.prototype[method],
                ),
            ).toEqual([EUserRoles.MOD.valueOf(), EUserRoles.ADMIN.valueOf()]);
        },
    );

    it("passes the filter to the service and dismisses by id", async () => {
        const getUnmappedGames = jest.fn().mockResolvedValue([[], 0]);
        const dismissUnmappedGame = jest.fn().mockResolvedValue(undefined);
        const controller = new ExternalGameController(
            { getUnmappedGames, dismissUnmappedGame } as any,
            {} as any,
        );
        const dto = { category: 1, limit: 5, offset: 10 };
        await controller.findUnmappedEntries(dto);
        await controller.dismissUnmappedEntry(7);
        expect(getUnmappedGames).toHaveBeenCalledWith(dto);
        expect(dismissUnmappedGame).toHaveBeenCalledWith(7);
    });
});
