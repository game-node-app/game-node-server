import { ConfigService } from "@nestjs/config";
import {
    XBOX_XERR_MESSAGES,
    XboxConnectionAuthProvider,
} from "./xbox-connection-auth.provider";
import axios from "axios";
import { HttpStatus } from "@nestjs/common";
import { EConnectionType } from "../../connection/connections.constants";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("XboxConnectionAuthProvider", () => {
    let configService: jest.Mocked<ConfigService>;
    let provider: XboxConnectionAuthProvider;

    beforeEach(() => {
        configService = {
            get: jest.fn((k: string) => {
                if (k === "XBOX_OAUTH_CLIENT_ID") return "ms-client-id-123";
                if (k === "XBOX_OAUTH_CLIENT_SECRET") return "ms-client-secret-456";
                if (k === "XBOX_OAUTH_REDIRECT_URI")
                    return "https://gamenode.app/connections/callback/xbox";
                return undefined;
            }),
        } as unknown as jest.Mocked<ConfigService>;

        provider = new XboxConnectionAuthProvider(configService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("initRedirectAuth", () => {
        it("should construct Microsoft OAuth 2.0 authorization URL with Xboxlive scopes and state", async () => {
            const result = await provider.initRedirectAuth({
                userId: "user-1",
                state: "state-xbox-123",
            });

            expect(result.state).toBe("state-xbox-123");
            expect(result.authorizationUrl).toContain(
                "https://login.live.com/oauth20_authorize.srf",
            );

            const parsed = new URL(result.authorizationUrl);
            expect(parsed.searchParams.get("client_id")).toBe("ms-client-id-123");
            expect(parsed.searchParams.get("response_type")).toBe("code");
            expect(parsed.searchParams.get("scope")).toBe(
                "Xboxlive.signin Xboxlive.offline_access",
            );
            expect(parsed.searchParams.get("state")).toBe("state-xbox-123");
            expect(parsed.searchParams.get("redirect_uri")).toBe(
                "https://gamenode.app/connections/callback/xbox",
            );
        });
    });

    describe("completeRedirectAuth", () => {
        it("should successfully exchange code -> MS tokens -> XBL -> XSTS and extract profile claims", async () => {
            // Step 1: MS Token Exchange
            mockedAxios.post.mockResolvedValueOnce({
                data: {
                    access_token: "ms-access-token",
                    refresh_token: "ms-refresh-token",
                    expires_in: 3600,
                },
            });

            // Step 2: XBL User Auth
            mockedAxios.post.mockResolvedValueOnce({
                data: {
                    Token: "xbl-token-abc",
                    DisplayClaims: {
                        xui: [{ uhs: "uhs-hash-123" }],
                    },
                },
            });

            // Step 3: XSTS Authorize
            mockedAxios.post.mockResolvedValueOnce({
                data: {
                    Token: "xsts-token-xyz",
                    NotAfter: "2026-10-25T20:00:00.000Z",
                    DisplayClaims: {
                        xui: [
                            {
                                uhs: "uhs-hash-123",
                                xid: "2533274991234567",
                                gtg: "MasterChief117",
                            },
                        ],
                    },
                },
            });

            const result = await provider.completeRedirectAuth(
                { code: "valid-auth-code" },
                { userId: "user-1", type: EConnectionType.XBOX },
            );

            expect(result.sourceUserId).toBe("2533274991234567");
            expect(result.sourceUsername).toBe("MasterChief117");
            expect(result.credentials).toBeDefined();
            expect(result.credentials?.accessToken).toBe("ms-access-token");
            expect(result.credentials?.refreshToken).toBe("ms-refresh-token");
            expect(result.credentials?.providerMetadata).toEqual({
                xstsToken: "xsts-token-xyz",
                userHash: "uhs-hash-123",
                xstsExpiresAt: "2026-10-25T20:00:00.000Z",
            });
        });

        it("should map XErr 2148916233 (no Xbox profile) to descriptive HTTP 400", async () => {
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: "ms-token", expires_in: 3600 },
            });
            mockedAxios.post.mockResolvedValueOnce({
                data: { Token: "xbl-token" },
            });
            mockedAxios.post.mockRejectedValueOnce({
                response: {
                    status: 400,
                    data: {
                        XErr: 2148916233,
                    },
                },
            });

            await expect(
                provider.completeRedirectAuth(
                    { code: "code-no-profile" },
                    { userId: "user-1", type: EConnectionType.XBOX },
                ),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
                message: expect.stringContaining(
                    "active Xbox Live profile",
                ),
            });
        });

        it("should map XErr 2148916238 (child account consent) to descriptive HTTP 400", async () => {
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: "ms-token", expires_in: 3600 },
            });
            mockedAxios.post.mockRejectedValueOnce({
                response: {
                    status: 401,
                    data: {
                        XErr: 2148916238,
                    },
                },
            });

            await expect(
                provider.completeRedirectAuth(
                    { code: "code-child" },
                    { userId: "user-1", type: EConnectionType.XBOX },
                ),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
                message: expect.stringContaining("Child account requires family consent"),
            });
        });

        it("should reject callbacks with Microsoft errors or missing code", async () => {
            await expect(
                provider.completeRedirectAuth(
                    { error: "access_denied", error_description: "User canceled" },
                    { userId: "user-1", type: EConnectionType.XBOX },
                ),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
                message: expect.stringContaining("User canceled"),
            });

            await expect(
                provider.completeRedirectAuth(
                    {},
                    { userId: "user-1", type: EConnectionType.XBOX },
                ),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
                message: expect.stringContaining("Missing authorization code"),
            });
        });
    });
});
