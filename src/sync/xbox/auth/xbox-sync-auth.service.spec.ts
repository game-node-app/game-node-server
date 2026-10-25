import { setPlayerProviderBudget } from "../../player-provider-budget.service";
jest.mock("@xboxreplay/xboxlive-auth", () => ({ authenticate: jest.fn() }));
jest.mock("axios");
import { authenticate } from "@xboxreplay/xboxlive-auth";
import axios from "axios";
import { XboxSyncAuthService } from "./xbox-sync-auth.service";
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "../../../connection/connections.constants";
import { ProviderSyncError } from "../../provider-sync.error";

const mockedAxios = axios as jest.Mocked<typeof axios>;

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

beforeEach(() => {
    jest.clearAllMocks();
    lockValues = new Map();
    setPlayerProviderBudget({ run: (_provider, work) => work() });
});

test("Xbox authentication preserves exposed status/cause without exposing credentials", async () => {
    const cause = {
        data: { attributes: { extra: { statusCode: 403 } } },
        message: "password=secret",
    };
    jest.mocked(authenticate).mockRejectedValue(cause);
    const service = new XboxSyncAuthService(
        {
            get: (key: string) =>
                key === "XBOX_API_USER" ? "fixture@example.com" : "secret",
        } as any,
        { get: jest.fn().mockResolvedValue(undefined) } as any,
        { findOne: jest.fn().mockResolvedValue(null) } as any,
        {} as any,
        queue,
    );
    const error = await service
        .getCatalogAuthCredentials()
        .catch((error) => error);
    expect(error).toMatchObject({ outcome: "unavailable", status: 403, cause });
    expect(JSON.stringify(error)).not.toContain("secret");
});

describe("XboxSyncAuthService.getUserAuthCredentials", () => {
    let inMemoryCache: Map<string, any>;
    let mockCache: any;
    let mockConnectionRepo: any;
    let mockCredentialService: any;
    let mockConfigService: any;

    beforeEach(() => {
        inMemoryCache = new Map();
        mockCache = {
            get: jest.fn(async (key: string) => inMemoryCache.get(key)),
            set: jest.fn(async (key: string, val: any) =>
                inMemoryCache.set(key, val),
            ),
            del: jest.fn(async (key: string) => inMemoryCache.delete(key)),
        };
        mockConfigService = {
            get: jest.fn((key: string) => {
                if (key === "XBOX_OAUTH_CLIENT_ID") return "test-client-id";
                if (key === "XBOX_OAUTH_CLIENT_SECRET")
                    return "test-client-secret";
                return undefined;
            }),
        };
        mockConnectionRepo = {
            findOne: jest.fn(),
            save: jest.fn(),
        };
        mockCredentialService = {
            getCredentials: jest.fn(),
            saveCredentials: jest.fn(),
        };
    });

    it("rejects when no Xbox connection exists with unsupported outcome", async () => {
        mockConnectionRepo.findOne.mockResolvedValue(null);
        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        await expect(
            service.getUserAuthCredentials("xuid-123"),
        ).rejects.toThrow(expect.objectContaining({ outcome: "unsupported" }));
    });

    it("bounds lock waiting and never releases or renews a successor's lock", async () => {
        jest.useFakeTimers();
        try {
            const service = new XboxSyncAuthService(
                mockConfigService,
                mockCache,
                mockConnectionRepo,
                mockCredentialService,
                queue,
            );
            lockValues.set("lock", "successor");
            const waiting = (service as any).acquireLock("lock", "old", 50);
            await jest.advanceTimersByTimeAsync(50);
            expect(await waiting).toBe(false);
            expect(await (service as any).renewLock("lock", "old")).toBe(0);
            await (service as any).releaseLock("lock", "old");
            expect(lockValues.get("lock")).toBe("successor");
        } finally {
            jest.useRealTimers();
        }
    });

    it("renews a long refresh and rejects writes after lock ownership is lost", async () => {
        jest.useFakeTimers();
        const connection = {
            id: 10,
            sourceUserId: "xuid-123",
            authStatus: EConnectionAuthStatus.CONNECTED,
        };
        mockConnectionRepo.findOne.mockResolvedValue(connection);
        mockCredentialService.getCredentials.mockResolvedValue({
            accessToken: "old",
            refreshToken: "refresh",
            providerMetadata: { xstsExpiresAt: new Date(0).toISOString() },
        });
        let resume!: () => void;
        mockedAxios.post
            .mockImplementationOnce(async () => {
                await new Promise<void>((resolve) => {
                    resume = resolve;
                });
                return {
                    data: { access_token: "new", refresh_token: "rotated" },
                };
            })
            .mockResolvedValueOnce({ data: { Token: "xbl" } })
            .mockResolvedValueOnce({
                data: {
                    Token: "xsts",
                    NotAfter: new Date(Date.now() + 3600000).toISOString(),
                    DisplayClaims: { xui: [{ uhs: "hash" }] },
                },
            });
        try {
            const service = new XboxSyncAuthService(
                mockConfigService,
                mockCache,
                mockConnectionRepo,
                mockCredentialService,
                queue,
            );
            const pending = service.getUserAuthCredentials("xuid-123");
            const rejected = expect(pending).rejects.toMatchObject({
                outcome: "unavailable",
            });
            await jest.advanceTimersByTimeAsync(20000);
            expect(
                redis.eval.mock.calls.some(([script]) =>
                    script.includes("PEXPIRE"),
                ),
            ).toBe(true);
            lockValues.set("xbox-token-refresh-lock:10", "successor");
            resume();
            await rejected;
            expect(
                mockCredentialService.saveCredentials,
            ).not.toHaveBeenCalled();
            expect(lockValues.get("xbox-token-refresh-lock:10")).toBe(
                "successor",
            );
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it("rejects when connection is in reauth_required status", async () => {
        mockConnectionRepo.findOne.mockResolvedValue({
            id: 10,
            type: EConnectionType.XBOX,
            sourceUserId: "xuid-123",
            authStatus: EConnectionAuthStatus.REAUTH_REQUIRED,
        });
        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        await expect(
            service.getUserAuthCredentials("xuid-123"),
        ).rejects.toThrow(
            expect.objectContaining({ outcome: "reauth_required" }),
        );
    });

    it("returns valid cached XSTS token and userHash without calling refresh endpoints", async () => {
        mockConnectionRepo.findOne.mockResolvedValue({
            id: 10,
            type: EConnectionType.XBOX,
            sourceUserId: "xuid-123",
            authStatus: EConnectionAuthStatus.CONNECTED,
        });
        // Valid for next 30 minutes (> 5 min buffer)
        const futureDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        mockCredentialService.getCredentials.mockResolvedValue({
            accessToken: "valid-access-token",
            refreshToken: "valid-refresh-token",
            providerMetadata: {
                xstsToken: "cached-xsts-token",
                userHash: "cached-user-hash",
                xstsExpiresAt: futureDate,
            },
        });

        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        const creds = await service.getUserAuthCredentials("xuid-123");
        expect(creds).toEqual({
            XSTSToken: "cached-xsts-token",
            userHash: "cached-user-hash",
        });
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("rotates expired tokens, exchanges XBL and XSTS, and saves updated credentials", async () => {
        const connection = {
            id: 10,
            type: EConnectionType.XBOX,
            sourceUserId: "xuid-123",
            authStatus: EConnectionAuthStatus.CONNECTED,
        };
        mockConnectionRepo.findOne.mockResolvedValue(connection);

        // Expired XSTS
        const pastDate = new Date(Date.now() - 1000).toISOString();
        mockCredentialService.getCredentials.mockResolvedValue({
            accessToken: "old-access-token",
            refreshToken: "old-refresh-token",
            providerMetadata: {
                xstsToken: "old-xsts-token",
                userHash: "old-user-hash",
                xstsExpiresAt: pastDate,
            },
        });

        // Mock OAuth refresh, XBL authenticate, and XSTS authorize responses
        mockedAxios.post
            .mockResolvedValueOnce({
                data: {
                    access_token: "new-access-token",
                    refresh_token: "new-refresh-token",
                    expires_in: 3600,
                },
            } as any)
            .mockResolvedValueOnce({
                data: {
                    Token: "new-xbl-token",
                },
            } as any)
            .mockResolvedValueOnce({
                data: {
                    Token: "new-xsts-token",
                    NotAfter: new Date(Date.now() + 3600 * 1000).toISOString(),
                    DisplayClaims: {
                        xui: [{ uhs: "new-uhs-hash", xid: "xuid-123" }],
                    },
                },
            } as any);

        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        const creds = await service.getUserAuthCredentials("xuid-123");
        expect(creds).toEqual({
            XSTSToken: "new-xsts-token",
            userHash: "new-uhs-hash",
        });

        expect(mockCredentialService.saveCredentials).toHaveBeenCalledWith(
            10,
            expect.objectContaining({
                accessToken: "new-access-token",
                refreshToken: "new-refresh-token",
                providerMetadata: {
                    xstsToken: "new-xsts-token",
                    userHash: "new-uhs-hash",
                    xstsExpiresAt: expect.any(String),
                },
            }),
        );
    });

    it("transitions connection to reauth_required and throws ProviderSyncError when refresh returns invalid_grant", async () => {
        const connection = {
            id: 10,
            type: EConnectionType.XBOX,
            sourceUserId: "xuid-123",
            authStatus: EConnectionAuthStatus.CONNECTED,
        };
        mockConnectionRepo.findOne.mockResolvedValue(connection);

        const pastDate = new Date(Date.now() - 1000).toISOString();
        mockCredentialService.getCredentials.mockResolvedValue({
            accessToken: "old-access-token",
            refreshToken: "revoked-refresh-token",
            providerMetadata: {
                xstsToken: "old-xsts-token",
                userHash: "old-user-hash",
                xstsExpiresAt: pastDate,
            },
        });

        mockedAxios.post.mockRejectedValueOnce({
            response: {
                status: 400,
                data: {
                    error: "invalid_grant",
                    error_description: "The provided grant has been revoked",
                },
            },
        });

        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        await expect(
            service.getUserAuthCredentials("xuid-123"),
        ).rejects.toThrow(
            expect.objectContaining({ outcome: "reauth_required" }),
        );

        expect(connection.authStatus).toBe(
            EConnectionAuthStatus.REAUTH_REQUIRED,
        );
        expect(mockConnectionRepo.save).toHaveBeenCalledWith(connection);
    });

    it("serializes concurrent refreshes with a lock so second caller reuses token refreshed by the first", async () => {
        const connection = {
            id: 10,
            type: EConnectionType.XBOX,
            sourceUserId: "xuid-123",
            authStatus: EConnectionAuthStatus.CONNECTED,
        };
        mockConnectionRepo.findOne.mockResolvedValue(connection);

        const pastDate = new Date(Date.now() - 1000).toISOString();
        let storedCredentials: any = {
            accessToken: "old-access-token",
            refreshToken: "old-refresh-token",
            providerMetadata: {
                xstsToken: "old-xsts-token",
                userHash: "old-user-hash",
                xstsExpiresAt: pastDate,
            },
        };

        mockCredentialService.getCredentials.mockImplementation(
            async () => storedCredentials,
        );
        mockCredentialService.saveCredentials.mockImplementation(
            async (_id: number, creds: any) => {
                storedCredentials = creds;
            },
        );

        mockedAxios.post
            .mockImplementationOnce(async () => {
                // Introduce slight delay so second call attempts to acquire lock concurrently
                await new Promise((r) => setTimeout(r, 40));
                return {
                    data: {
                        access_token: "refreshed-access-token",
                        refresh_token: "refreshed-refresh-token",
                        expires_in: 3600,
                    },
                } as any;
            })
            .mockResolvedValueOnce({
                data: {
                    Token: "refreshed-xbl-token",
                },
            } as any)
            .mockResolvedValueOnce({
                data: {
                    Token: "refreshed-xsts-token",
                    NotAfter: new Date(Date.now() + 3600 * 1000).toISOString(),
                    DisplayClaims: {
                        xui: [{ uhs: "refreshed-uhs", xid: "xuid-123" }],
                    },
                },
            } as any);

        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        const otherService = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );
        const [res1, res2] = await Promise.all([
            service.getUserAuthCredentials("xuid-123"),
            otherService.getUserAuthCredentials("xuid-123"),
        ]);

        expect(res1).toEqual({
            XSTSToken: "refreshed-xsts-token",
            userHash: "refreshed-uhs",
        });
        expect(res2).toEqual({
            XSTSToken: "refreshed-xsts-token",
            userHash: "refreshed-uhs",
        });

        // OAuth token refresh was called only once across both calls
        expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    });
});

describe("XboxSyncAuthService.getCatalogAuthCredentials", () => {
    let mockCache: any;
    let mockConfigService: any;
    let mockConnectionRepo: any;
    let mockCredentialService: any;

    beforeEach(() => {
        mockCache = {
            get: jest.fn().mockResolvedValue(undefined),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
        };
        mockConfigService = {
            get: jest.fn((key: string) => {
                if (key === "XBOX_API_USER") return "system@example.com";
                if (key === "XBOX_API_PASS") return "system-pass";
                return undefined;
            }),
        };
        mockConnectionRepo = {
            findOne: jest.fn(),
            save: jest.fn(),
        };
        mockCredentialService = {
            getCredentials: jest.fn(),
            saveCredentials: jest.fn(),
        };
    });

    it("returns cached catalog credentials from cacheManager if present", async () => {
        mockCache.get.mockResolvedValueOnce({
            XSTSToken: "catalog-xsts",
            userHash: "catalog-uhs",
            expiresAt: Date.now() + 3600000,
        });

        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        const result = await service.getCatalogAuthCredentials();
        expect(result).toEqual({
            XSTSToken: "catalog-xsts",
            userHash: "catalog-uhs",
        });
        expect(authenticate).not.toHaveBeenCalled();
    });

    it("uses system credentials (XBOX_API_USER/XBOX_API_PASS) when configured", async () => {
        jest.mocked(authenticate).mockResolvedValueOnce({
            xsts_token: "system-xsts",
            user_hash: "system-uhs",
            expires_on: new Date(Date.now() + 3600 * 1000).toISOString(),
        } as any);

        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        const result = await service.getCatalogAuthCredentials();
        expect(result).toEqual({
            XSTSToken: "system-xsts",
            userHash: "system-uhs",
        });
        expect(mockCache.set).toHaveBeenCalledWith(
            "xbox-catalog-auth-cred",
            expect.objectContaining({
                XSTSToken: "system-xsts",
                userHash: "system-uhs",
                expiresAt: expect.any(Number),
            }),
            expect.any(Number),
        );
    });

    it("ignores a near-expiry cached catalog token", async () => {
        mockCache.get.mockResolvedValue({
            XSTSToken: "stale",
            userHash: "old",
            expiresAt: Date.now() + 30000,
        });
        jest.mocked(authenticate).mockResolvedValueOnce({
            xsts_token: "fresh",
            user_hash: "new",
            expires_on: new Date(Date.now() + 3600000).toISOString(),
        } as any);
        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );
        await expect(service.getCatalogAuthCredentials()).resolves.toEqual({
            XSTSToken: "fresh",
            userHash: "new",
        });
        expect(authenticate).toHaveBeenCalledTimes(1);
    });

    it("falls back to active connected Xbox user when system credentials are not configured", async () => {
        mockConfigService.get.mockReturnValue(undefined); // No system creds

        mockConnectionRepo.findOne.mockResolvedValue({
            id: 15,
            type: EConnectionType.XBOX,
            sourceUserId: "connected-xuid-456",
            authStatus: EConnectionAuthStatus.CONNECTED,
        });

        const futureDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        mockCredentialService.getCredentials.mockResolvedValue({
            accessToken: "user-access",
            refreshToken: "user-refresh",
            providerMetadata: {
                xstsToken: "user-fallback-xsts",
                userHash: "user-fallback-uhs",
                xstsExpiresAt: futureDate,
            },
        });

        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        const result = await service.getCatalogAuthCredentials();
        expect(result).toEqual({
            XSTSToken: "user-fallback-xsts",
            userHash: "user-fallback-uhs",
        });
        expect(mockCache.set).toHaveBeenCalledWith(
            "xbox-catalog-auth-cred",
            expect.objectContaining({
                XSTSToken: "user-fallback-xsts",
                userHash: "user-fallback-uhs",
                expiresAt: expect.any(Number),
            }),
            expect.any(Number),
        );
        const ttl = mockCache.set.mock.calls[0][2];
        expect(ttl).toBeGreaterThan(24 * 60 * 1000);
        expect(ttl).toBeLessThanOrEqual(25 * 60 * 1000);
    });

    it("throws ProviderSyncError with outcome unavailable when neither system nor user credentials available", async () => {
        mockConfigService.get.mockReturnValue(undefined);
        mockConnectionRepo.findOne.mockResolvedValue(null);

        const service = new XboxSyncAuthService(
            mockConfigService,
            mockCache,
            mockConnectionRepo,
            mockCredentialService,
            queue,
        );

        await expect(service.getCatalogAuthCredentials()).rejects.toThrow(
            expect.objectContaining({ outcome: "unavailable" }),
        );
    });
});
