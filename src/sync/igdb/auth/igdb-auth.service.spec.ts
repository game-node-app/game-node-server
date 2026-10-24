import { Cache } from "@nestjs/cache-manager";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { of } from "rxjs";
import { IgdbAuthService } from "./igdb-auth.service";

describe("IgdbAuthService", () => {
    it("invalidates stale credentials and shares one forced refresh without logging secrets", async () => {
        const cache = {
            get: jest.fn().mockResolvedValue("old-token"),
            del: jest.fn().mockResolvedValue(true),
            set: jest.fn().mockResolvedValue(undefined),
        };
        const post = jest
            .fn()
            .mockReturnValue(
                of({ data: { access_token: "new-token", expires_in: 3600 } }),
            );
        const logs = jest
            .spyOn(Logger.prototype, "log")
            .mockImplementation(() => undefined);
        const service = new IgdbAuthService(
            { getOrThrow: () => "client-secret" } as unknown as ConfigService,
            cache as unknown as Cache,
            { post } as unknown as HttpService,
        );
        try {
            expect(await service.getAuthToken()).toBe("old-token");
            const headers = await Promise.all([
                service.getAuthHeaders(true),
                service.getAuthHeaders(true),
            ]);
            expect(headers[0].Authorization).toBe("Bearer new-token");
            expect(headers[1]).toEqual(headers[0]);
            expect(cache.del).toHaveBeenCalledWith("igdb-auth-token");
            expect(cache.del).toHaveBeenCalledTimes(1);
            expect(post).toHaveBeenCalledTimes(1);
            expect(cache.set).toHaveBeenCalledWith(
                "igdb-auth-token",
                "new-token",
                3600000,
            );
            expect(cache.del.mock.invocationCallOrder[0]).toBeLessThan(
                post.mock.invocationCallOrder[0],
            );
            const output = JSON.stringify(logs.mock.calls);
            for (const secret of ["old-token", "new-token", "client-secret"])
                expect(output).not.toContain(secret);
        } finally {
            logs.mockRestore();
        }
    });
});
