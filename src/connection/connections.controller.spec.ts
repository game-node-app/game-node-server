import { ConnectionsController } from "./connections.controller";
import { EConnectionType } from "./connections.constants";

describe("ConnectionsController", () => {
    test("the settings alias resolves the authenticated owner's connection", async () => {
        const findOneByUserIdAndTypeOrFail = jest
            .fn()
            .mockResolvedValue({ id: 5 });
        const updateSettings = jest.fn().mockResolvedValue({ id: 5 });
        const controller = new ConnectionsController(
            {
                findOneByUserIdAndTypeOrFail,
                updateSettings,
            } as any,
            {} as any,
        );
        const dto = { isAutoImportEnabled: true };
        await controller.updateOwnSettings(
            { getUserId: () => "owner" } as any,
            EConnectionType.XBOX,
            dto,
        );
        expect(findOneByUserIdAndTypeOrFail).toHaveBeenCalledWith(
            "owner",
            EConnectionType.XBOX,
        );
        expect(updateSettings).toHaveBeenCalledWith("owner", 5, dto);
    });
    test("connection updates use the authenticated owner", async () => {
        const createOrUpdate = jest.fn().mockResolvedValue({ id: 1 });
        const controller = new ConnectionsController(
            { createOrUpdate } as any,
            {} as any,
        );
        const dto = {
            type: EConnectionType.STEAM,
            sourceUserId: "account",
        } as any;
        expect(
            await controller.createOrUpdate(
                { getUserId: () => "owner" } as any,
                dto,
            ),
        ).toEqual({ id: 1 });
        expect(createOrUpdate).toHaveBeenCalledWith("owner", dto);
    });

    test("initRedirectAuth delegates to service with authenticated userId and params", async () => {
        const initRedirectAuth = jest.fn().mockResolvedValue({
            authorizationUrl: "https://auth.example.com",
            state: "state-123",
        });
        const controller = new ConnectionsController(
            {
                initRedirectAuth,
            } as any,
            {} as any,
        );
        const dto = { isAutoImportEnabled: true };

        const result = await controller.initRedirectAuth(
            { getUserId: () => "owner-1" } as any,
            EConnectionType.STEAM,
            dto,
        );

        expect(result).toEqual({
            authorizationUrl: "https://auth.example.com",
            state: "state-123",
        });
        expect(initRedirectAuth).toHaveBeenCalledWith(
            "owner-1",
            EConnectionType.STEAM,
            dto,
        );
    });

    test("completeRedirectAuth delegates to service with authenticated userId and params", async () => {
        const completeRedirectAuth = jest.fn().mockResolvedValue({
            id: 1,
            type: EConnectionType.STEAM,
        });
        const controller = new ConnectionsController(
            {
                completeRedirectAuth,
            } as any,
            {} as any,
        );
        const dto = {
            state: "state-123",
            callbackParams: { code: "oauth-code" },
        };

        const result = await controller.completeRedirectAuth(
            { getUserId: () => "owner-1" } as any,
            EConnectionType.STEAM,
            dto,
        );

        expect(result).toEqual({ id: 1, type: EConnectionType.STEAM });
        expect(completeRedirectAuth).toHaveBeenCalledWith(
            "owner-1",
            EConnectionType.STEAM,
            dto,
        );
    });

    test("updateSettings delegates to service with authenticated userId, id and dto", async () => {
        const updateSettings = jest.fn().mockResolvedValue({
            id: 5,
            isAutoImportEnabled: false,
        });
        const controller = new ConnectionsController(
            { updateSettings } as any,
            {} as any,
        );
        const dto = { isAutoImportEnabled: false };

        const result = await controller.updateSettings(
            { getUserId: () => "owner-1" } as any,
            5,
            dto,
        );

        expect(result).toEqual({ id: 5, isAutoImportEnabled: false });
        expect(updateSettings).toHaveBeenCalledWith("owner-1", 5, dto);
    });
});
