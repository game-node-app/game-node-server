import { PSN_SYSTEM_AUTH_FAILED } from "./psn-sync-auth.service";
import { PsnSyncAuthScheduler } from "./psn-sync-auth.scheduler";

function setup(auth: Partial<Record<"hasNpsso" | "getValidAccessToken", jest.Mock>>) {
    const scheduler = new PsnSyncAuthScheduler({
        hasNpsso: jest.fn().mockResolvedValue(true),
        ...auth,
    } as any);
    const logger = (scheduler as any).logger;
    const error = jest.spyOn(logger, "error").mockImplementation();
    const warn = jest.spyOn(logger, "warn").mockImplementation();
    return { scheduler, error, warn };
}

const daysFromNow = (d: number) =>
    new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();

describe("PsnSyncAuthScheduler", () => {
    test("healthy credential logs nothing", async () => {
        const { scheduler, error, warn } = setup({
            getValidAccessToken: jest.fn().mockResolvedValue({ refreshTokenExpiresAt: daysFromNow(30) }),
        });
        await scheduler.check();
        expect(error).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });

    test("failure logs an error with the marker", async () => {
        const { scheduler, error } = setup({
            getValidAccessToken: jest.fn().mockRejectedValue(new Error(`${PSN_SYSTEM_AUTH_FAILED}: boom`)),
        });
        await scheduler.check();
        expect(error).toHaveBeenCalledWith(`${PSN_SYSTEM_AUTH_FAILED}: boom`);
    });

    test("unexpected errors get the marker too", async () => {
        const { scheduler, error } = setup({
            getValidAccessToken: jest.fn().mockRejectedValue(new Error("redis down")),
        });
        await scheduler.check();
        expect(error).toHaveBeenCalledWith(`${PSN_SYSTEM_AUTH_FAILED}: redis down`);
    });

    test("refresh token expiring within 7 days warns with the date", async () => {
        const expiresAt = daysFromNow(3);
        const { scheduler, warn } = setup({
            getValidAccessToken: jest.fn().mockResolvedValue({ refreshTokenExpiresAt: expiresAt }),
        });
        await scheduler.check();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(expiresAt));
    });

    test("no NPSSO skips silently without calling Sony", async () => {
        const getValidAccessToken = jest.fn();
        const { scheduler, error, warn } = setup({
            hasNpsso: jest.fn().mockResolvedValue(false),
            getValidAccessToken,
        });
        await scheduler.check();
        expect(getValidAccessToken).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });

    test("a concurrent run is ignored", async () => {
        let release!: (v: unknown) => void;
        const getValidAccessToken = jest.fn(
            () => new Promise((r) => (release = r)),
        );
        const { scheduler } = setup({ getValidAccessToken });
        const first = scheduler.check();
        await new Promise((r) => setImmediate(r));
        await scheduler.check();
        release({ refreshTokenExpiresAt: daysFromNow(30) });
        await first;
        expect(getValidAccessToken).toHaveBeenCalledTimes(1);
    });
});
