import { PlaytimeWatchService } from "./playtime-watch.service";
import { EConnectionType } from "../../connection/connections.constants";

test("the compatibility service awaits shared full-refresh admission", async () => {
    const request = jest.fn().mockResolvedValue({ status: "accepted" });
    const service = new PlaytimeWatchService({ request } as any);
    await expect(
        service.registerJob("user", EConnectionType.STEAM),
    ).resolves.toEqual({ status: "accepted" });
    expect(request).toHaveBeenCalledWith("user", EConnectionType.STEAM);
    const failure = new Error("Redis unavailable");
    request.mockRejectedValue(failure);
    await expect(
        service.registerJob("user", EConnectionType.STEAM),
    ).rejects.toBe(failure);
});
