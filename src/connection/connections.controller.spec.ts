import { ConnectionsController } from "./connections.controller";
import { EConnectionType } from "./connections.constants";

test("connection updates use the authenticated owner", async () => {
    const createOrUpdate = jest.fn().mockResolvedValue({ id: 1 });
    const controller = new ConnectionsController({ createOrUpdate } as any);
    const dto = { type: EConnectionType.STEAM, sourceUserId: "account" } as any;
    expect(
        await controller.createOrUpdate(
            { getUserId: () => "owner" } as any,
            dto,
        ),
    ).toEqual({ id: 1 });
    expect(createOrUpdate).toHaveBeenCalledWith("owner", dto);
});
