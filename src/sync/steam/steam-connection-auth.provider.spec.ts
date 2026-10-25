import { ConfigService } from "@nestjs/config";
import { SteamConnectionAuthProvider } from "./steam-connection-auth.provider";
import { SteamSyncService } from "./steam-sync.service";
import axios from "axios";
import { HttpStatus } from "@nestjs/common";
import { EConnectionType } from "../../connection/connections.constants";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("SteamConnectionAuthProvider", () => {
    let configService: jest.Mocked<ConfigService>;
    let steamSyncService: jest.Mocked<SteamSyncService>;
    let provider: SteamConnectionAuthProvider;

    beforeEach(() => {
        configService = {
            get: jest.fn((k: string) =>
                k === "DOMAIN_WEBSITE" ? "https://gamenode.app" : undefined,
            ),
        } as unknown as jest.Mocked<ConfigService>;

        steamSyncService = {
            getUserSummary: jest.fn().mockResolvedValue({
                steamID: "76561198000000001",
                nickname: "SteamGamer",
            }),
        } as unknown as jest.Mocked<SteamSyncService>;

        provider = new SteamConnectionAuthProvider(
            configService,
            steamSyncService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("initRedirectAuth", () => {
        it("should construct the canonical Steam OpenID 2.0 authorization URL with state", async () => {
            const result = await provider.initRedirectAuth({
                userId: "user-1",
                state: "state-token-abc",
            });

            expect(result.state).toBe("state-token-abc");
            expect(result.authorizationUrl).toContain(
                "https://steamcommunity.com/openid/login",
            );

            const parsed = new URL(result.authorizationUrl);
            expect(parsed.searchParams.get("openid.ns")).toBe(
                "http://specs.openid.net/auth/2.0",
            );
            expect(parsed.searchParams.get("openid.mode")).toBe(
                "checkid_setup",
            );
            expect(parsed.searchParams.get("openid.realm")).toBe(
                "https://gamenode.app",
            );
            expect(parsed.searchParams.get("openid.return_to")).toBe(
                "https://gamenode.app/connections/callback/steam?state=state-token-abc",
            );
        });
    });

    describe("completeRedirectAuth", () => {
        const validClaimedId =
            "https://steamcommunity.com/openid/id/76561198000000001";
        const validParams = {
            "openid.return_to":
                "https://gamenode.app/connections/callback/steam?state=state-token-abc",
            "openid.mode": "id_res",
            "openid.claimed_id": validClaimedId,
            "openid.identity": validClaimedId,
            "openid.sig": "signature-bytes",
            "openid.signed": "signed-keys",
            "openid.assoc_handle": "assoc-123",
        };

        it("should verify valid callback parameters via Steam check_authentication and return user profile", async () => {
            mockedAxios.post.mockResolvedValueOnce({
                data: "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n",
            });

            const result = await provider.completeRedirectAuth(validParams, {
                userId: "user-1",
                type: EConnectionType.STEAM,
                metadata: { returnTo: validParams["openid.return_to"] },
            });

            expect(mockedAxios.post).toHaveBeenCalledWith(
                "https://steamcommunity.com/openid/login",
                expect.stringContaining("openid.mode=check_authentication"),
                expect.objectContaining({
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }),
            );

            expect(result.sourceUserId).toBe("76561198000000001");
            expect(result.sourceUsername).toBe("SteamGamer");
        });

        it.each([
            "https://evil.example/connections/callback/steam?state=state-token-abc",
            "https://gamenode.app/wrong?state=state-token-abc",
            "https://gamenode.app/connections/callback/steam?state=different",
            undefined,
        ])("rejects an unrelated return URL: %s", async (returnTo) => {
            await expect(
                provider.completeRedirectAuth(
                    { ...validParams, "openid.return_to": returnTo },
                    {
                        userId: "user-1",
                        type: EConnectionType.STEAM,
                        metadata: { returnTo: validParams["openid.return_to"] },
                    },
                ),
            ).rejects.toMatchObject({ status: 400 });
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("should reject forged or unverified signatures with HTTP 400", async () => {
            mockedAxios.post.mockResolvedValueOnce({
                data: "ns:http://specs.openid.net/auth/2.0\nis_valid:false\n",
            });

            await expect(
                provider.completeRedirectAuth(validParams, {
                    userId: "user-1",
                    type: EConnectionType.STEAM,
                    metadata: { returnTo: validParams["openid.return_to"] },
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
        });

        it("should reject malformed or non-canonical claimed_id format with HTTP 400", async () => {
            const badParams = {
                ...validParams,
                "openid.claimed_id":
                    "https://evil.com/openid/id/76561198000000001",
                "openid.identity":
                    "https://evil.com/openid/id/76561198000000001",
            };

            await expect(
                provider.completeRedirectAuth(badParams, {
                    userId: "user-1",
                    type: EConnectionType.STEAM,
                    metadata: { returnTo: validParams["openid.return_to"] },
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("should reject mismatched claimed_id and identity with HTTP 400", async () => {
            const mismatchedParams = {
                ...validParams,
                "openid.claimed_id":
                    "https://steamcommunity.com/openid/id/76561198000000001",
                "openid.identity":
                    "https://steamcommunity.com/openid/id/76561198000000002",
            };

            await expect(
                provider.completeRedirectAuth(mismatchedParams, {
                    userId: "user-1",
                    type: EConnectionType.STEAM,
                    metadata: { returnTo: validParams["openid.return_to"] },
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("should reject callbacks with openid.mode !== 'id_res' with HTTP 400", async () => {
            const cancelParams = {
                ...validParams,
                "openid.mode": "cancel",
            };

            await expect(
                provider.completeRedirectAuth(cancelParams, {
                    userId: "user-1",
                    type: EConnectionType.STEAM,
                    metadata: { returnTo: validParams["openid.return_to"] },
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
        });
    });
});
