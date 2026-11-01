import { HttpStatus } from "@nestjs/common";
import axios from "axios";
import { EpicConnectionAuthProvider } from "./epic-connection-auth.provider";

jest.mock("axios");
const post = jest.mocked(axios.post);

const CODE = "0123456789abcdef0123456789abcdef";
const config = {
    get: (key: string) =>
        ({ EPIC_OAUTH_CLIENT_ID: "id", EPIC_OAUTH_CLIENT_SECRET: "secret" })[
            key
        ],
} as any;
const provider = new EpicConnectionAuthProvider(config);
const tokenResponse = {
    data: {
        access_token: "access",
        refresh_token: "refresh",
        expires_at: "2030-01-01T00:00:00.000Z",
        refresh_expires_at: "2030-02-01T00:00:00.000Z",
        account_id: "acct",
        displayName: "Player",
    },
};

beforeEach(() => jest.clearAllMocks());

describe("EpicConnectionAuthProvider", () => {
    it("returns the login URL on init without sending the state to Epic", async () => {
        const result = await provider.initRedirectAuth({
            userId: "u",
            state: "s1",
        });
        expect(result.authorizationUrl).toContain(
            "https://www.epicgames.com/id/login?redirectUrl=",
        );
        expect(result.authorizationUrl).not.toContain("s1");
        expect(result.state).toBe("s1");
    });

    it.each([
        ["a raw code", CODE],
        ["the JSON page body", JSON.stringify({ authorizationCode: CODE })],
    ])("exchanges %s", async (_name, input) => {
        post.mockResolvedValueOnce(tokenResponse);
        const result = await provider.completeRedirectAuth({ code: input });
        expect(post.mock.calls[0][1]).toContain(`code=${CODE}`);
        expect(result).toMatchObject({
            sourceUserId: "acct",
            sourceUsername: "Player",
            credentials: {
                accessToken: "access",
                refreshToken: "refresh",
                expiresAt: new Date("2030-01-01T00:00:00.000Z"),
            },
        });
    });

    it.each([undefined, "", "not-a-code", '{"authorizationCode":"x"}'])(
        "rejects malformed input %p without calling Epic",
        async (input) => {
            await expect(
                provider.completeRedirectAuth({ code: input }),
            ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
            expect(post).not.toHaveBeenCalled();
        },
    );

    it("rejects with 400 and returns no credentials when Epic refuses the code", async () => {
        post.mockRejectedValueOnce({
            response: { data: { errorCode: "invalid_grant" } },
        });
        await expect(
            provider.completeRedirectAuth({ code: CODE }),
        ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
});
