import axios from "axios";
import { inspect } from "node:util";
import tokenFixture from "./fixtures/token-response.json";
import profileFixture from "./fixtures/profile.json";
import invalidRefresh from "./fixtures/invalid-refresh.json";
import invalidCode from "./fixtures/invalid-authorization-code.json";
import {
    getGogProfile,
    GOG_CLIENT_ID,
    GOG_REDIRECT_URI,
    GOG_TOKEN_URL,
    GOG_USERS_URL,
    requestGogToken,
    toGogCredentials,
} from "./gog-oauth";

jest.mock("axios");
const get = jest.mocked(axios.get);
const grant = { grant_type: "authorization_code", code: "test-code" } as const;
const refresh = {
    grant_type: "refresh_token",
    refresh_token: "test-refresh-token",
} as const;

beforeEach(() => jest.resetAllMocks());

describe("GOG token protocol", () => {
    it("parses the redacted token fixture without rounding its account ID", async () => {
        get.mockResolvedValueOnce({ data: tokenFixture.body });
        await expect(requestGogToken(grant)).resolves.toEqual({
            access_token: tokenFixture.body.access_token,
            refresh_token: tokenFixture.body.refresh_token,
            expires_in: 3600,
            user_id: "90000000000000001",
        });
        expect(get).toHaveBeenCalledWith(GOG_TOKEN_URL, {
            params: {
                client_id: GOG_CLIENT_ID,
                client_secret: expect.any(String),
                redirect_uri: GOG_REDIRECT_URI,
                ...grant,
            },
            timeout: 15_000,
            maxRedirects: 0,
        });
    });

    it("converts seconds to an expiry without inventing a refresh expiry", () => {
        const now = jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
        try {
            expect(toGogCredentials(tokenFixture.body)).toEqual({
                accessToken: tokenFixture.body.access_token,
                refreshToken: tokenFixture.body.refresh_token,
                expiresAt: new Date(1_800_003_600_000),
                refreshTokenExpiresAt: null,
            });
        } finally {
            now.mockRestore();
        }
    });

    it.each([
        null,
        [],
        {},
        { ...tokenFixture.body, access_token: "" },
        { ...tokenFixture.body, access_token: "bad\r\nheader" },
        { ...tokenFixture.body, refresh_token: "" },
        { ...tokenFixture.body, refresh_token: null },
        { ...tokenFixture.body, refresh_token: undefined },
        { ...tokenFixture.body, user_id: undefined },
        { ...tokenFixture.body, user_id: 90000000000000001 },
        { ...tokenFixture.body, user_id: "1/../../other" },
        { ...tokenFixture.body, expires_in: "3600" },
        ...[0, -1, NaN, Infinity, 1e20, 1e-10].map((expires_in) => ({
            ...tokenFixture.body,
            expires_in,
        })),
    ])("rejects malformed token response %#", async (data) => {
        get.mockResolvedValueOnce({ data });
        await expect(requestGogToken(grant)).rejects.toMatchObject({
            outcome: "incomplete",
        });
    });

    it("accepts refresh responses omitting replacement grant and identity", async () => {
        get.mockResolvedValueOnce({
            data: { access_token: "replacement", expires_in: 3600 },
        });
        await expect(requestGogToken(refresh)).resolves.toEqual({
            access_token: "replacement",
            expires_in: 3600,
        });
        expect(get.mock.calls[0][1]?.params).toMatchObject(refresh);
        expect(get.mock.calls[0][1]?.params).not.toHaveProperty("redirect_uri");
    });

    it("classifies the captured invalid refresh response for reauthentication", async () => {
        get.mockRejectedValueOnce({
            response: {
                status: invalidRefresh.status,
                data: invalidRefresh.body,
            },
        });
        await expect(requestGogToken(refresh)).rejects.toMatchObject({
            outcome: "reauth_required",
            status: 400,
        });
    });

    it("does not classify a rejected authorization code as a revoked refresh", async () => {
        get.mockRejectedValueOnce({
            response: { status: invalidCode.status, data: invalidCode.body },
        });
        await expect(requestGogToken(grant)).rejects.toMatchObject({
            outcome: "failed",
            status: 400,
        });
    });

    it.each([401, 403, 429, 500])(
        "preserves status %s without guessing revoked-grant semantics",
        async (status) => {
            get.mockRejectedValueOnce({
                response: {
                    status,
                    data: { error: "invalid_grant" },
                    headers: { "retry-after": "2" },
                },
            });
            await expect(requestGogToken(refresh)).rejects.toMatchObject({
                outcome:
                    status === 429
                        ? "throttled"
                        : status === 500
                          ? "failed"
                          : "unavailable",
                status,
                retryAfterMs: 2000,
            });
        },
    );

    it.each([grant, refresh])(
        "discards sensitive errors for $grant_type",
        async (input) => {
            const secret = "private-query-value";
            get.mockRejectedValueOnce({
                message: `${GOG_TOKEN_URL}?code=${secret}`,
                config: { params: { refresh_token: secret } },
                response: { status: 500, data: { error_description: secret } },
            });
            const error = await requestGogToken(input).catch(
                (failure) => failure,
            );
            expect(error).toMatchObject({ outcome: "failed", status: 500 });
            expect(error.cause).toBeUndefined();
            expect(
                `${String(error)}${inspect(error)}${JSON.stringify(error)}`,
            ).not.toContain(secret);
            expect(inspect(error)).not.toContain(GOG_TOKEN_URL);
        },
    );
});

describe("GOG profile identity", () => {
    it("parses the redacted profile with exact token/profile identity", async () => {
        get.mockResolvedValueOnce({ data: profileFixture.body });
        await expect(
            getGogProfile(tokenFixture.body.user_id, "access-token"),
        ).resolves.toEqual(profileFixture.body);
        expect(get).toHaveBeenCalledWith(
            `${GOG_USERS_URL}/${tokenFixture.body.user_id}`,
            {
                headers: { Authorization: "Bearer access-token" },
                timeout: 15_000,
                maxRedirects: 0,
            },
        );
    });

    it.each([
        null,
        {},
        { ...profileFixture.body, id: 90000000000000001 },
        { ...profileFixture.body, id: "90000000000000002" },
        { ...profileFixture.body, username: " " },
        { ...profileFixture.body, username: undefined },
    ])("rejects a malformed/mismatched profile %#", async (data) => {
        get.mockResolvedValueOnce({ data });
        await expect(
            getGogProfile(tokenFixture.body.user_id, "access-token"),
        ).rejects.toMatchObject({ outcome: "incomplete" });
    });

    it("rejects an unsafe input identity before any request", async () => {
        await expect(
            getGogProfile("../other", "access-token"),
        ).rejects.toMatchObject({
            outcome: "incomplete",
        });
        expect(get).not.toHaveBeenCalled();
    });

    it("never exposes bearer credentials from profile failures", async () => {
        get.mockRejectedValueOnce({
            message: "sensitive-access-token",
            config: {
                headers: { Authorization: "Bearer sensitive-access-token" },
            },
            response: { status: 401 },
        });
        const error = await getGogProfile(
            "123",
            "sensitive-access-token",
        ).catch((failure) => failure);
        expect(error).toMatchObject({ outcome: "unavailable", status: 401 });
        expect(error.cause).toBeUndefined();
        expect(inspect(error)).not.toContain("sensitive-access-token");
    });
});
