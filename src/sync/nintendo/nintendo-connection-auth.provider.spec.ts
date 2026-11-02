jest.mock("axios");
import { HttpStatus } from "@nestjs/common";
import axios from "axios";
import { NintendoConnectionAuthProvider } from "./nintendo-connection-auth.provider";

const post = jest.mocked(axios.post);
const get = jest.mocked(axios.get);
const provider = new NintendoConnectionAuthProvider();

const link = (fragment: string) => `npf5c38e31cd085304b://auth#${fragment}`;
const saved = {
    codeVerifier: "verifier",
    metadata: { state: "s1" },
} as any;
const sessionJwt = `h.${Buffer.from(JSON.stringify({ exp: 1900000000 })).toString("base64url")}.s`;

beforeEach(() => jest.clearAllMocks());

describe("NintendoConnectionAuthProvider", () => {
    it("builds the login URL with an S256 challenge and the state", async () => {
        const result = await provider.initRedirectAuth({
            userId: "u",
            state: "s1",
        });
        const url = new URL(result.authorizationUrl);
        expect(url.searchParams.get("state")).toBe("s1");
        expect(
            url.searchParams.get("session_token_code_challenge"),
        ).toBeTruthy();
        expect(
            url.searchParams.get("session_token_code_challenge_method"),
        ).toBe("S256");
        expect(result.codeVerifier).toBeTruthy();
        expect(result.metadata).toEqual({ state: "s1" });
    });

    it("links the account from a valid pasted link", async () => {
        post.mockResolvedValueOnce({
            data: { session_token: sessionJwt },
        }).mockResolvedValueOnce({
            data: { access_token: "access", expires_in: 900 },
        });
        get.mockResolvedValueOnce({ data: { id: "acct", nickname: "Player" } });
        const result = await provider.completeRedirectAuth(
            { code: ` ${link("session_token_code=abc&state=s1")} ` },
            saved,
        );
        expect(
            new URLSearchParams(post.mock.calls[0][1] as string).get(
                "session_token_code_verifier",
            ),
        ).toBe("verifier");
        expect(result).toMatchObject({
            sourceUserId: "acct",
            sourceUsername: "Player",
            credentials: {
                accessToken: "access",
                refreshToken: sessionJwt,
                refreshTokenExpiresAt: new Date(1900000000 * 1000),
            },
        });
    });

    it.each([
        ["missing input", undefined],
        ["a non-link", "abc"],
        ["a link without the code", link("state=s1")],
        ["a state mismatch", link("session_token_code=abc&state=other")],
    ])("rejects %s with 400 and no Nintendo call", async (_name, code) => {
        await expect(
            provider.completeRedirectAuth({ code }, saved),
        ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
        expect(post).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();
    });

    it("rejects with 400 when Nintendo refuses the code", async () => {
        post.mockRejectedValueOnce({
            response: { data: { error: "invalid_grant" } },
        });
        await expect(
            provider.completeRedirectAuth(
                { code: link("session_token_code=abc&state=s1") },
                saved,
            ),
        ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
});
