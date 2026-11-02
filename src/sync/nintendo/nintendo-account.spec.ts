jest.mock("axios");
import axios from "axios";
import {
    getNintendoUser,
    NINTENDO_USER_AGENT,
    requestAccessToken,
    requestSessionToken,
} from "./nintendo-account";

const post = jest.mocked(axios.post);
const get = jest.mocked(axios.get);

beforeEach(() => jest.clearAllMocks());

describe("nintendo-account", () => {
    it("exchanges the code as a form post with the verifier", async () => {
        post.mockResolvedValueOnce({ data: { session_token: "s" } });
        await expect(requestSessionToken("code", "ver")).resolves.toEqual({
            session_token: "s",
        });
        const [url, body, config] = post.mock.calls[0];
        expect(url).toContain("/api/session_token");
        const params = new URLSearchParams(body as string);
        expect(params.get("client_id")).toBe("5c38e31cd085304b");
        expect(params.get("session_token_code")).toBe("code");
        expect(params.get("session_token_code_verifier")).toBe("ver");
        expect(config?.headers).toMatchObject({
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": NINTENDO_USER_AGENT,
        });
    });

    it("requests the access token as JSON with the jwt-bearer grant", async () => {
        post.mockResolvedValueOnce({
            data: { access_token: "a", expires_in: 900 },
        });
        await requestAccessToken("session");
        const [url, body, config] = post.mock.calls[0];
        expect(url).toContain("/api/token");
        expect(body).toEqual({
            client_id: "5c38e31cd085304b",
            session_token: "session",
            grant_type:
                "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token",
        });
        expect(config?.headers).toMatchObject({
            "Content-Type": "application/json",
        });
    });

    it("reads the user with a bearer token", async () => {
        get.mockResolvedValueOnce({ data: { id: "u", nickname: "n" } });
        await expect(getNintendoUser("a")).resolves.toEqual({
            id: "u",
            nickname: "n",
        });
        expect(get.mock.calls[0][0]).toContain("/2.0.0/users/me");
        expect(get.mock.calls[0][1]?.headers).toMatchObject({
            Authorization: "Bearer a",
        });
    });

    it("throws the raw axios error", async () => {
        const error = { response: { status: 400 } };
        post.mockRejectedValueOnce(error);
        await expect(requestAccessToken("s")).rejects.toBe(error);
    });
});
