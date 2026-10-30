import { BadRequestException } from "@nestjs/common";
import {
    exchangeCodeForAccessToken,
    exchangeNpssoForCode,
    exchangeRefreshTokenForAuthTokens,
} from "psn-api";
import { ConnectionCredentialCryptoService } from "../../../connection/connection-credential-crypto.service";
import {
    PSN_SYSTEM_AUTH_FAILED,
    PsnSyncAuthService,
} from "./psn-sync-auth.service";

jest.mock("psn-api");
jest.mock("../../player-sync-attempt", () => ({
    uncancellableProviderCall: (_p: string, work: () => Promise<unknown>) =>
        work(),
}));

const KEY = "psn-auth-access-token";
const goodAuth = {
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 3600,
    refreshTokenExpiresIn: 60 * 24 * 3600,
};
const rejectedAuth = { accessToken: undefined } as any;

function setup(opts: { env?: string; row?: { npssoEncrypted: string } } = {}) {
    const store = new Map<string, any>();
    const cache = {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: any) => void store.set(k, v)),
        del: jest.fn(async (k: string) => void store.delete(k)),
    };
    let row = opts.row ?? null;
    const repo = {
        findOneBy: jest.fn(async () => row),
        countBy: jest.fn(async () => (row ? 1 : 0)),
        upsert: jest.fn(async (v: any) => void (row = v)),
    };
    const crypto = new ConnectionCredentialCryptoService();
    crypto.initializeKey("a".repeat(32));
    const service = new PsnSyncAuthService(
        { get: () => opts.env } as any,
        cache as any,
        repo as any,
        crypto,
    );
    return { service, store, cache, repo, crypto };
}

const expiredToken = {
    accessToken: "old",
    refreshToken: "old-refresh",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 1e9).toISOString(),
};

beforeEach(() => {
    jest.resetAllMocks();
    (exchangeNpssoForCode as jest.Mock).mockResolvedValue("code");
    (exchangeCodeForAccessToken as jest.Mock).mockResolvedValue(goodAuth);
});

describe("PsnSyncAuthService", () => {
    test("first access exchanges the env NPSSO and stores the token", async () => {
        const { service, store } = setup({ env: "env-npsso" });
        const token = await service.getValidAccessToken();
        expect(exchangeNpssoForCode).toHaveBeenCalledWith("env-npsso");
        expect(store.get(KEY)).toEqual(token);
    });

    test("expired token is refreshed without reading the NPSSO", async () => {
        const { service, repo } = setup({ env: "env-npsso" });
        (service as any).cacheManager.set(KEY, expiredToken);
        (exchangeRefreshTokenForAuthTokens as jest.Mock).mockResolvedValue(
            goodAuth,
        );
        const token = await service.getValidAccessToken();
        expect(token.accessToken).toBe("access");
        expect(repo.findOneBy).not.toHaveBeenCalled();
    });

    test("valid token does not consult the database", async () => {
        const { service, repo } = setup({ env: "env-npsso" });
        const valid = { ...expiredToken, expiresAt: new Date(Date.now() + 1e6).toISOString() };
        (service as any).cacheManager.set(KEY, valid);
        expect(await service.getValidAccessToken()).toEqual(valid);
        expect(repo.findOneBy).not.toHaveBeenCalled();
    });

    test("rejected refresh falls back to a valid NPSSO", async () => {
        const { service, store } = setup({ env: "env-npsso" });
        store.set(KEY, expiredToken);
        (exchangeRefreshTokenForAuthTokens as jest.Mock).mockResolvedValue(
            rejectedAuth,
        );
        const token = await service.getValidAccessToken();
        expect(token.accessToken).toBe("access");
        expect(exchangeNpssoForCode).toHaveBeenCalledTimes(1);
        expect(store.get(KEY).accessToken).toBe("access");
    });

    test("rejected refresh and invalid NPSSO throw the marker and leave the cache empty", async () => {
        const { service, store } = setup({ env: "env-npsso" });
        store.set(KEY, expiredToken);
        (exchangeRefreshTokenForAuthTokens as jest.Mock).mockResolvedValue(
            rejectedAuth,
        );
        (exchangeNpssoForCode as jest.Mock).mockRejectedValue(
            new Error("bad npsso"),
        );
        await expect(service.getValidAccessToken()).rejects.toThrow(
            new RegExp(`^${PSN_SYSTEM_AUTH_FAILED}: refresh failed .*NPSSO exchange failed \\(bad npsso\\)`),
        );
        expect(store.has(KEY)).toBe(false);
        expect(exchangeNpssoForCode).toHaveBeenCalledTimes(1);
    });

    test("no NPSSO anywhere throws the marker", async () => {
        const { service } = setup();
        await expect(service.getValidAccessToken()).rejects.toThrow(
            PSN_SYSTEM_AUTH_FAILED,
        );
        expect(await service.hasNpsso()).toBe(false);
    });

    test("the database NPSSO takes precedence over the env one", async () => {
        const { service, crypto } = setup({ env: "env-npsso" });
        (service as any).credentialRepository.findOneBy.mockResolvedValue({
            npssoEncrypted: crypto.encrypt("db-npsso"),
        });
        await service.getValidAccessToken();
        expect(exchangeNpssoForCode).toHaveBeenCalledWith("db-npsso");
    });

    describe("rotateNpsso", () => {
        test("persists the NPSSO encrypted, stores the token and returns the expiry only", async () => {
            const { service, repo, crypto, store } = setup({ env: "env-npsso" });
            const logs: string[] = [];
            jest.spyOn((service as any).logger, "log").mockImplementation((m: any) => void logs.push(String(m)));
            const expiresAt = await service.rotateNpsso("new-npsso");
            const saved = repo.upsert.mock.calls[0][0];
            expect(saved.npssoEncrypted).not.toContain("new-npsso");
            expect(crypto.decrypt(saved.npssoEncrypted)).toBe("new-npsso");
            expect(store.get(KEY).accessToken).toBe("access");
            expect(expiresAt).toBe(store.get(KEY).refreshTokenExpiresAt);
            expect(logs.join()).not.toContain("new-npsso");
            expect(await service.hasNpsso()).toBe(true);
        });

        test("a rejected NPSSO is a 400 and changes nothing", async () => {
            const { service, repo, store } = setup({ env: "env-npsso" });
            (exchangeNpssoForCode as jest.Mock).mockRejectedValue(
                new Error("bad npsso"),
            );
            await expect(service.rotateNpsso("bad")).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(repo.upsert).not.toHaveBeenCalled();
            expect(store.size).toBe(0);
        });
    });
});
