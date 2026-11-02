jest.mock("axios");
jest.mock("../../../connection/mark-reauth-required");
import axios from "axios";
import { setPlayerProviderBudget } from "../../player-provider-budget.service";
import { NintendoSyncAuthService } from "./nintendo-sync-auth.service";
import { EConnectionAuthStatus } from "../../../connection/connections.constants";
import { markReauthRequired } from "../../../connection/mark-reauth-required";

const post = jest.mocked(axios.post);
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
    new NintendoSyncAuthService(
        connectionRepo as any,
        credentialService as any,
    );

beforeEach(() => {
    jest.clearAllMocks();
    connection = {
        id: 7,
        sourceUserId: "acct",
        authStatus: EConnectionAuthStatus.CONNECTED,
    };
    stored = {
        accessToken: "old",
        refreshToken: "session",
        expiresAt: inMinutes(10),
    };
    connectionRepo.findOne.mockResolvedValue(connection);
    setPlayerProviderBudget({ run: (_provider, work) => work() });
});

describe("NintendoSyncAuthService.getAccessToken", () => {
    it("reuses a token that is valid for more than five minutes", async () => {
        await expect(service().getAccessToken("acct")).resolves.toBe("old");
        expect(post).not.toHaveBeenCalled();
    });

    it("refreshes an expiring token and keeps the session token", async () => {
        stored.expiresAt = inMinutes(2);
        post.mockResolvedValueOnce({
            data: { access_token: "new", expires_in: 900 },
        });
        await expect(service().getAccessToken("acct")).resolves.toBe("new");
        expect(credentialService.saveCredentials).toHaveBeenCalledWith(
            7,
            expect.objectContaining({
                accessToken: "new",
                refreshToken: "session",
            }),
        );
    });

    it("sets reauth_required once on invalid_grant", async () => {
        stored.expiresAt = inMinutes(1);
        post.mockRejectedValue({
            response: { status: 400, data: { error: "invalid_grant" } },
        });
        await expect(service().getAccessToken("acct")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(markReauthRequired).toHaveBeenCalledWith(manager, connection);
    });

    it("sets reauth_required when no session token is stored", async () => {
        stored = { accessToken: "old", expiresAt: inMinutes(1) };
        await expect(service().getAccessToken("acct")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
        expect(post).not.toHaveBeenCalled();
        expect(markReauthRequired).toHaveBeenCalledWith(manager, connection);
    });

    it("keeps the connection on a 5xx", async () => {
        stored.expiresAt = inMinutes(1);
        post.mockRejectedValue({ response: { status: 503 } });
        await expect(service().getAccessToken("acct")).rejects.toMatchObject({
            outcome: "failed",
        });
        expect(transaction).not.toHaveBeenCalled();
    });

    it("fails fast for a connection that already needs reauth", async () => {
        connection.authStatus = EConnectionAuthStatus.REAUTH_REQUIRED;
        await expect(service().getAccessToken("acct")).rejects.toMatchObject({
            outcome: "reauth_required",
        });
        expect(transaction).not.toHaveBeenCalled();
    });
});
