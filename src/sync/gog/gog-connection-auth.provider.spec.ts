import axios from "axios";
import { GogConnectionAuthProvider } from "./gog-connection-auth.provider";
import token from "./fixtures/token-response.json";
import profile from "./fixtures/profile.json";
import { GOG_REDIRECT_URI } from "./gog-oauth";

jest.mock("axios");
const get = jest.mocked(axios.get);
const provider = new GogConnectionAuthProvider();
const callback = `${GOG_REDIRECT_URI}&code=test-code`;
beforeEach(() => jest.resetAllMocks());

it("returns the fixed GOG login URL and keeps GameNode state local", async () => {
    const result = await provider.initRedirectAuth({
        userId: "u",
        state: "local-state",
    });
    const url = new URL(result.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://auth.gog.com/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(GOG_REDIRECT_URI);
    expect(url.searchParams.get("layout")).toBe("galaxy");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(result.state).toBe("local-state");
    expect(result.authorizationUrl).not.toContain("local-state");
});

it("exchanges only the code, validates identity and returns credentials for encryption", async () => {
    get.mockResolvedValueOnce({ data: token.body }).mockResolvedValueOnce({
        data: profile.body,
    });
    expect(
        await provider.completeRedirectAuth({ code: callback }),
    ).toMatchObject({
        sourceUserId: profile.body.id,
        sourceUsername: profile.body.username,
        credentials: {
            accessToken: token.body.access_token,
            refreshToken: token.body.refresh_token,
        },
    });
    expect(get.mock.calls[0][1]?.params.code).toBe("test-code");
    expect(get.mock.calls.map((call) => call[0])).not.toContain(callback);
});

it.each([
    undefined,
    "",
    "test-code",
    "https://evil.test/on_login_success?origin=client&code=x",
    callback.replace("https:", "http:"),
    callback.replace("embed.gog.com", "embed.gog.com.evil.test"),
    callback.replace("/on_login_success", "/wrong"),
    callback.replace("origin=client", "origin=web"),
    callback.replace("embed.gog.com", "user:password@embed.gog.com"),
    callback.replace("embed.gog.com", "embed.gog.com:444"),
    `${callback}&code=duplicate`,
    `${callback}&origin=client`,
    GOG_REDIRECT_URI,
    `${GOG_REDIRECT_URI}&code=`,
    `${callback}#fragment`,
    `${GOG_REDIRECT_URI}&code=%20`,
    `${GOG_REDIRECT_URI}&code=${"x".repeat(2049)}`,
])("rejects invalid callback %# before any request", async (code) => {
    await expect(provider.completeRedirectAuth({ code })).rejects.toMatchObject(
        { status: 400 },
    );
    expect(get).not.toHaveBeenCalled();
});

it.each(["exchange", "profile", "mismatch"])(
    "safely fails %s without returning credentials",
    async (stage) => {
        if (stage === "exchange")
            get.mockRejectedValueOnce(new Error(callback));
        else {
            get.mockResolvedValueOnce({ data: token.body });
            if (stage === "profile")
                get.mockRejectedValueOnce(new Error("private-token"));
            else
                get.mockResolvedValueOnce({
                    data: { ...profile.body, id: "42" },
                });
        }
        await expect(
            provider.completeRedirectAuth({ code: callback }),
        ).rejects.toMatchObject({
            status: 400,
            message: "Failed to authenticate GOG account",
        });
    },
);
