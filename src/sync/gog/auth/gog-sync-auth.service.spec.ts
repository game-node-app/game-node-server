import { setPlayerProviderBudget } from "../../player-provider-budget.service";
jest.mock("axios");
jest.mock("../../../connection/mark-reauth-required");
import axios from "axios";
import { GogSyncAuthService } from "./gog-sync-auth.service";
import { EConnectionAuthStatus } from "../../../connection/connections.constants";
import { markReauthRequired } from "../../../connection/mark-reauth-required";

const get = jest.mocked(axios.get);

let lockValues: Map<string, string>;
const redis = {
    set: jest.fn(async (key: string, value: string) => {
        if (lockValues.has(key)) return null;
        lockValues.set(key, value);
        return "OK";
    }),
    get: jest.fn(async (key: string) => lockValues.get(key)),
    eval: jest.fn(
        async (script: string, _count: number, key: string, token: string) => {
            if (lockValues.get(key) !== token) return 0;
            if (script.includes("DEL")) lockValues.delete(key);
            return 1;
        },
    ),
};
const queue = { client: Promise.resolve(redis) } as any;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
let stored: any;
let connection: any;
const manager = {};
const transaction = jest.fn(async (work) => work(manager));
const connectionRepo = { findOne: jest.fn(), manager: { transaction } };
const credentialService = {
    getCredentials: jest.fn(async () => stored),
    saveCredentials: jest.fn(async (_id: number, creds: any) => {
        stored = creds;
    }),
};
const service = () =>
    new GogSyncAuthService(
        connectionRepo as any,
        credentialService as any,
        queue,
    );

beforeEach(() => {
    jest.clearAllMocks();
    lockValues = new Map();
    connection = {
        id: 7,
        sourceUserId: "123",
        authStatus: EConnectionAuthStatus.CONNECTED,
    };
    stored = {
        accessToken: "old",
        refreshToken: "refresh",
        expiresAt: inMinutes(60),
    };
    connectionRepo.findOne.mockResolvedValue(connection);
    setPlayerProviderBudget({ run: (_provider, work) => work() });
});

describe("GogSyncAuthService.getAccessToken", () => {
    it("reuses a token that is valid for more than five minutes", async () => {
        await expect(service().getAccessToken("123")).resolves.toBe("old");
        expect(get).not.toHaveBeenCalled();
    });

    it("sends one refresh for two concurrent callers and saves the rotated tokens", async () => {
        stored.expiresAt = inMinutes(2);
        get.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {
                data: {
                    access_token: "new",
                    refresh_token: "refresh-2",
                    expires_in: 7200,
                    user_id: "123",
                },
            };
        });
        const auth = service();
        const tokens = await Promise.all([
            auth.getAccessToken("123"),
            auth.getAccessToken("123"),
        ]);
        expect(tokens).toEqual(["new", "new"]);
        expect(get).toHaveBeenCalledTimes(1);
        expect(credentialService.saveCredentials).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ refreshToken: "refresh-2" }),
        );
    });

    it("sets reauth_required when Gog revokes the refresh token", async () => {
        stored.expiresAt = inMinutes(1);
        get.mockRejectedValue({
            response: {
                status: 400,
                data: {
                    error: "invalid_grant",
                },
            },
        });
        await expect(service().getAccessToken("123")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(markReauthRequired).toHaveBeenCalledWith(manager, connection);
    });

    it("sets reauth_required when no refresh token is stored", async () => {
        stored = { accessToken: "old", expiresAt: inMinutes(1) };
        await expect(service().getAccessToken("123")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
        expect(get).not.toHaveBeenCalled();
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(markReauthRequired).toHaveBeenCalledWith(manager, connection);
    });

    it("fails fast for a connection that already needs reauth", async () => {
        connection.authStatus = EConnectionAuthStatus.REAUTH_REQUIRED;
        await expect(service().getAccessToken("123")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
        expect(transaction).not.toHaveBeenCalled();
    });
});

it("retains the current grant when refresh omits a replacement", async () => {
    stored.expiresAt = inMinutes(1);
    get.mockResolvedValueOnce({
        data: { access_token: "new", expires_in: 3600 },
    });
    await expect(service().getAccessToken("123")).resolves.toBe("new");
    expect(stored.refreshToken).toBe("refresh");
});

it.each([429, 500])(
    "preserves credentials and status on %s",
    async (status) => {
        stored.expiresAt = inMinutes(1);
        const before = { ...stored };
        get.mockRejectedValueOnce({ response: { status } });
        await expect(service().getAccessToken("123")).rejects.toBeDefined();
        expect(stored).toEqual(before);
        expect(markReauthRequired).not.toHaveBeenCalled();
        expect(lockValues.size).toBe(0);
    },
);

it.each(["mismatch", "lock-lost", "malformed", "reconnected"])(
    "rejects %s without saving",
    async (kind) => {
        stored.expiresAt = inMinutes(1);
        get.mockImplementationOnce(async () => {
            if (kind === "lock-lost") lockValues.clear();
            if (kind === "reconnected") connection.sourceUserId = "456";
            return {
                data: {
                    access_token: "new",
                    expires_in: kind === "malformed" ? -1 : 3600,
                    user_id: kind === "mismatch" ? "456" : "123",
                },
            };
        });
        await expect(service().getAccessToken("123")).rejects.toBeDefined();
        expect(credentialService.saveCredentials).not.toHaveBeenCalled();
        expect(markReauthRequired).not.toHaveBeenCalled();
    },
);

it("marks missing credentials for reauthentication under the lock", async () => {
    stored = null;
    await expect(service().getAccessToken("123")).rejects.toMatchObject({
        outcome: "reauth_required",
    });
    expect(markReauthRequired).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
});

it("reports catalogue unavailable when no connected account is usable", async () => {
    const repo = { ...connectionRepo, find: async () => [] };
    const auth = new GogSyncAuthService(
        repo as any,
        credentialService as any,
        queue,
    );
    await expect(auth.getCatalogueAccountId()).rejects.toMatchObject({
        outcome: "unavailable",
    });
});
