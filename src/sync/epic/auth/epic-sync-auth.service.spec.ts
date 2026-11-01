import { setPlayerProviderBudget } from "../../player-provider-budget.service";
jest.mock("axios");
import axios from "axios";
import { EpicSyncAuthService } from "./epic-sync-auth.service";
import { EConnectionAuthStatus } from "../../../connection/connections.constants";

const post = jest.mocked(axios.post);

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
const connectionRepo = { findOne: jest.fn(), save: jest.fn() };
const credentialService = {
    getCredentials: jest.fn(async () => stored),
    saveCredentials: jest.fn(async (_id: number, creds: any) => {
        stored = creds;
    }),
};
const config = { get: () => "x" } as any;
const service = () =>
    new EpicSyncAuthService(
        config,
        connectionRepo as any,
        credentialService as any,
        queue,
    );

beforeEach(() => {
    jest.clearAllMocks();
    lockValues = new Map();
    connection = {
        id: 7,
        sourceUserId: "acct",
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

describe("EpicSyncAuthService.getAccessToken", () => {
    it("reuses a token that is valid for more than five minutes", async () => {
        await expect(service().getAccessToken("acct")).resolves.toBe("old");
        expect(post).not.toHaveBeenCalled();
    });

    it("sends one refresh for two concurrent callers and saves the rotated tokens", async () => {
        stored.expiresAt = inMinutes(2);
        post.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {
                data: {
                    access_token: "new",
                    refresh_token: "refresh-2",
                    expires_at: inMinutes(120).toISOString(),
                    refresh_expires_at: inMinutes(9999).toISOString(),
                    account_id: "acct",
                },
            };
        });
        const auth = service();
        const tokens = await Promise.all([
            auth.getAccessToken("acct"),
            auth.getAccessToken("acct"),
        ]);
        expect(tokens).toEqual(["new", "new"]);
        expect(post).toHaveBeenCalledTimes(1);
        expect(credentialService.saveCredentials).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ refreshToken: "refresh-2" }),
        );
    });

    it("sets reauth_required when Epic revokes the refresh token", async () => {
        stored.expiresAt = inMinutes(1);
        post.mockRejectedValue({
            response: {
                status: 400,
                data: {
                    errorCode:
                        "errors.com.epicgames.account.auth_token.invalid_refresh_token",
                },
            },
        });
        await expect(service().getAccessToken("acct")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
        expect(connection.authStatus).toBe(
            EConnectionAuthStatus.REAUTH_REQUIRED,
        );
        expect(connectionRepo.save).toHaveBeenCalledWith(connection);
    });

    it("sets reauth_required when no refresh token is stored", async () => {
        stored = { accessToken: "old", expiresAt: inMinutes(1) };
        await expect(service().getAccessToken("acct")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
        expect(post).not.toHaveBeenCalled();
        expect(connection.authStatus).toBe(
            EConnectionAuthStatus.REAUTH_REQUIRED,
        );
    });

    it("fails fast for a connection that already needs reauth", async () => {
        connection.authStatus = EConnectionAuthStatus.REAUTH_REQUIRED;
        await expect(service().getAccessToken("acct")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
    });
});
