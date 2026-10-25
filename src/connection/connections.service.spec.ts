jest.mock("typeorm-transactional", () => ({
    runInTransaction: (work: () => Promise<unknown>) => work(),
}));
import {
    playerStateFixture,
    playerOwner,
} from "../sync/player-data/player-sync.fixture";
jest.mock("../sync/steam/steam-sync.service", () => ({
    SteamSyncService: class {},
}));
jest.mock("../sync/psn/psn-sync.service", () => ({ PsnSyncService: class {} }));
jest.mock("../sync/xbox/xbox-sync.service", () => ({
    XboxSyncService: class {},
}));
jest.mock("../playtime/watch/playtime-watch.service", () => ({
    PlaytimeWatchService: class {},
}));
jest.mock("../collections/collections.service", () => ({
    CollectionsService: class {},
}));
import { ConnectionsService, toDto } from "./connections.service";
import {
    EConnectionAuthMode,
    EConnectionAuthStatus,
    EConnectionType,
} from "./connections.constants";
import { UserConnection } from "./entity/user-connection.entity";
import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { ConnectionAuthStateService } from "./connection-auth-state.service";
import { ConnectionCredentialService } from "./connection-credential.service";
import { HttpException, HttpStatus } from "@nestjs/common";

describe("connection onboarding admission", () => {
    it("does not report success when the initial queue write fails", async () => {
        const failure = new Error("Redis unavailable");
        const save = jest
            .fn()
            .mockImplementation(async (connection) => connection);
        const providerRegistry = new ConnectionProviderRegistry();
        providerRegistry.registerAuthStrategy(EConnectionType.PSN, {
            resolvePublicIdentifier: jest
                .fn()
                .mockResolvedValue({
                    sourceUserId: "source-user",
                    sourceUsername: "source-name",
                }),
        });
        const service = new ConnectionsService(
            {
                findOne: jest.fn().mockResolvedValue(null),
                findOneBy: jest.fn().mockResolvedValue(null),
                save,
            } as any,
            { registerJob: jest.fn().mockRejectedValue(failure) } as any,
            {} as any,
            playerStateFixture() as any,
            providerRegistry,
            {} as any,
            {} as any,
        );
        await expect(
            service.createOrUpdate("test-user", {
                type: EConnectionType.PSN,
                userIdentifier: "source-user",
                isAutoImportEnabled: false,
            } as any),
        ).rejects.toBe(failure);
        expect(save).toHaveBeenCalledTimes(1);
    });
});

describe("ConnectionsService DTO safety & discovery", () => {
    it("toDto should include authStatus and never serialize UserConnectionCredential fields", () => {
        const entityWithCredentials = {
            id: 10,
            type: EConnectionType.XBOX,
            profileUserId: "profile-1",
            sourceUserId: "xuid-1",
            sourceUsername: "Gamertag",
            isAutoImportEnabled: true,
            autoImportCollectionId: null,
            autoImportCollection: null,
            authStatus: EConnectionAuthStatus.REAUTH_REQUIRED,
            profile: { id: "profile-1" },
            credential: {
                connectionId: 10,
                accessTokenEncrypted: "secret-access",
                refreshTokenEncrypted: "secret-refresh",
                providerMetadataEncrypted: "secret-meta",
            },
            accessTokenEncrypted: "should-not-leak",
            refreshTokenEncrypted: "should-not-leak",
        } as unknown as UserConnection;

        const dto = toDto(entityWithCredentials) as any;

        expect(dto.id).toBe(10);
        expect(dto.type).toBe(EConnectionType.XBOX);
        expect(dto.authStatus).toBe(EConnectionAuthStatus.REAUTH_REQUIRED);
        expect(dto.profileUserId).toBe("profile-1");

        // Must never serialize credential or encrypted fields
        expect(dto.profile).toBeUndefined();
        expect(dto.credential).toBeUndefined();
        expect(dto.accessTokenEncrypted).toBeUndefined();
        expect(dto.refreshTokenEncrypted).toBeUndefined();
        expect(dto.providerMetadataEncrypted).toBeUndefined();
    });

    it("findAvailableConnections should derive from registry and include authMode for each provider", async () => {
        const providerRegistry = new ConnectionProviderRegistry();
        providerRegistry.registerAuthStrategy(EConnectionType.PSN, {
            resolvePublicIdentifier: jest
                .fn()
                .mockResolvedValue({
                    sourceUserId: "source-user",
                    sourceUsername: "source-name",
                }),
        });
        const service = new ConnectionsService(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            providerRegistry,
            {} as any,
            {} as any,
        );

        const available = await service.findAvailableConnections();
        expect(available).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: EConnectionType.STEAM,
                    authMode: EConnectionAuthMode.REDIRECT,
                }),
                expect.objectContaining({
                    type: EConnectionType.XBOX,
                    authMode: EConnectionAuthMode.REDIRECT,
                }),
                expect.objectContaining({
                    type: EConnectionType.PSN,
                    authMode: EConnectionAuthMode.PUBLIC_IDENTIFIER,
                }),
            ]),
        );
    });
});

describe("ConnectionsService Auth Endpoints & Mode Enforcement", () => {
    let providerRegistry: ConnectionProviderRegistry;
    let authStateService: jest.Mocked<ConnectionAuthStateService>;
    let credentialService: jest.Mocked<ConnectionCredentialService>;
    let collectionsService: { findOneById: jest.Mock };
    let userConnectionRepo: {
        findOne: jest.Mock;
        findOneBy: jest.Mock;
        save: jest.Mock;
        delete: jest.Mock;
    };
    let syncState: any;
    let playtimeWatchService: { registerJob: jest.Mock };
    let service: ConnectionsService;

    beforeEach(() => {
        providerRegistry = new ConnectionProviderRegistry();
        providerRegistry.registerAuthStrategy(EConnectionType.PSN, {
            resolvePublicIdentifier: jest
                .fn()
                .mockResolvedValue({
                    sourceUserId: "psn-account-id",
                    sourceUsername: "psn-name",
                }),
        });
        authStateService = {
            initState: jest.fn().mockResolvedValue("state-token-123"),
            consumeState: jest.fn(),
        } as unknown as jest.Mocked<ConnectionAuthStateService>;
        credentialService = {
            saveCredentials: jest.fn().mockResolvedValue({} as any),
            getCredentials: jest.fn(),
            deleteCredentials: jest.fn(),
        } as unknown as jest.Mocked<ConnectionCredentialService>;
        collectionsService = {
            findOneById: jest.fn(),
        };
        userConnectionRepo = {
            findOne: jest.fn().mockResolvedValue(null),
            findOneBy: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation(async (entity) => ({
                id: 1,
                ...entity,
            })),
            delete: jest.fn(),
        };
        syncState = playerStateFixture();
        playtimeWatchService = {
            registerJob: jest.fn().mockResolvedValue(undefined),
        };

        service = new ConnectionsService(
            userConnectionRepo as any,
            playtimeWatchService as any,
            collectionsService as any,
            syncState as any,
            providerRegistry,
            authStateService,
            credentialService,
        );
    });

    describe("createOrUpdate (manual onboarding)", () => {
        it("rejects manual onboarding for redirect providers (steam, xbox) with HTTP 400", async () => {
            await expect(
                service.createOrUpdate("user-1", {
                    type: EConnectionType.STEAM,
                    userIdentifier: "steam-id",
                    isAutoImportEnabled: false,
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });

            await expect(
                service.createOrUpdate("user-1", {
                    type: EConnectionType.XBOX,
                    userIdentifier: "gamertag",
                    isAutoImportEnabled: false,
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
        });

        it("allows manual onboarding for public_identifier providers (psn)", async () => {
            await service.createOrUpdate("user-1", {
                type: EConnectionType.PSN,
                userIdentifier: "OnlineID",
                isAutoImportEnabled: false,
            });

            expect(userConnectionRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: EConnectionType.PSN,
                    profileUserId: "user-1",
                    sourceUserId: "psn-account-id",
                    sourceUsername: "psn-name",
                    authStatus: EConnectionAuthStatus.CONNECTED,
                }),
            );
        });
    });

    describe("initRedirectAuth", () => {
        it("rejects redirect init for public_identifier provider (psn) with HTTP 400", async () => {
            await expect(
                service.initRedirectAuth("user-1", EConnectionType.PSN, {}),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
        });

        it("rejects redirect init if autoImportCollectionId is not owned by user", async () => {
            providerRegistry.registerAuthStrategy(EConnectionType.STEAM, {
                initRedirectAuth: jest.fn().mockResolvedValue({
                    authorizationUrl: "https://steamcommunity.com/openid/login",
                }),
            });
            collectionsService.findOneById.mockResolvedValueOnce({
                id: "col-1",
                libraryUserId: "other-user",
            });

            await expect(
                service.initRedirectAuth("user-1", EConnectionType.STEAM, {
                    isAutoImportEnabled: true,
                    autoImportCollectionId: "col-1",
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
        });

        it("succeeds for redirect provider, generating authorizationUrl and saving state", async () => {
            const initRedirectAuth = jest
                .fn()
                .mockImplementation(async ({ state }) => ({
                    authorizationUrl: `https://steamcommunity.com/openid/login?state=${state}`,
                    state,
                }));
            providerRegistry.registerAuthStrategy(EConnectionType.STEAM, {
                initRedirectAuth,
            });

            const result = await service.initRedirectAuth(
                "user-1",
                EConnectionType.STEAM,
                {
                    isAutoImportEnabled: true,
                },
            );

            expect(result.authorizationUrl).toContain(
                "https://steamcommunity.com/openid/login?state=",
            );
            expect(result.state).toBeDefined();
            expect(authStateService.initState).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: "user-1",
                    type: EConnectionType.STEAM,
                    isAutoImportEnabled: true,
                }),
                result.state,
            );
        });
    });

    describe("completeRedirectAuth", () => {
        it("rejects redirect callback for public_identifier provider (psn) with HTTP 400", async () => {
            await expect(
                service.completeRedirectAuth("user-1", EConnectionType.PSN, {
                    state: "state-123",
                    callbackParams: {},
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
        });

        it("delegates to strategy and saves credentials on valid callback", async () => {
            const completeRedirectAuth = jest.fn().mockResolvedValue({
                sourceUserId: "steamid-76561198",
                sourceUsername: "GamerOne",
                credentials: {
                    accessToken: "token-abc",
                },
            });
            providerRegistry.registerAuthStrategy(EConnectionType.STEAM, {
                completeRedirectAuth,
            });

            authStateService.consumeState.mockResolvedValueOnce({
                userId: "user-1",
                type: EConnectionType.STEAM,
                isAutoImportEnabled: true,
                autoImportCollectionId: null,
            });

            const result = await service.completeRedirectAuth(
                "user-1",
                EConnectionType.STEAM,
                {
                    state: "valid-state",
                    callbackParams: { "openid.mode": "id_res" },
                },
            );

            expect(result.id).toBe(1);
            expect(result.sourceUserId).toBe("steamid-76561198");
            expect(result.sourceUsername).toBe("GamerOne");
            expect(result.authStatus).toBe(EConnectionAuthStatus.CONNECTED);
            expect(credentialService.saveCredentials).toHaveBeenCalledWith(1, {
                accessToken: "token-abc",
            });
            expect(syncState.initialize).toHaveBeenCalledTimes(1);
            expect(playtimeWatchService.registerJob).toHaveBeenCalledTimes(1);
        });
    });

    describe("updateSettings (Task 2.3)", () => {
        it("updates isAutoImportEnabled and autoImportCollectionId while preserving credentials and sync eligibility", async () => {
            const existing = {
                id: 15,
                type: EConnectionType.STEAM,
                profileUserId: "owner-1",
                sourceUserId: "steam-123",
                sourceUsername: "OwnerSteam",
                isAutoImportEnabled: false,
                autoImportCollectionId: null,
                authStatus: EConnectionAuthStatus.CONNECTED,
            } as UserConnection;

            userConnectionRepo.findOne.mockResolvedValueOnce(existing);
            collectionsService.findOneById.mockResolvedValueOnce({
                id: "valid-collection-uuid",
                libraryUserId: "owner-1",
            });

            const updated = await service.updateSettings("owner-1", 15, {
                isAutoImportEnabled: true,
                autoImportCollectionId: "valid-collection-uuid",
            });

            expect(userConnectionRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 15,
                    isAutoImportEnabled: true,
                    autoImportCollectionId: "valid-collection-uuid",
                }),
            );
            expect(updated.isAutoImportEnabled).toBe(true);
            expect(updated.autoImportCollectionId).toBe(
                "valid-collection-uuid",
            );

            // Credentials and sync state must NOT be touched
            expect(credentialService.deleteCredentials).not.toHaveBeenCalled();
            expect(credentialService.saveCredentials).not.toHaveBeenCalled();
            expect(syncState.initialize).not.toHaveBeenCalled();
        });

        it("rejects with HTTP 404 if connection not found or owned by another user", async () => {
            userConnectionRepo.findOne.mockResolvedValueOnce(null);
            await expect(
                service.updateSettings("owner-1", 999, {
                    isAutoImportEnabled: true,
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.NOT_FOUND,
            });

            const notMine = {
                id: 20,
                profileUserId: "someone-else",
            } as UserConnection;
            userConnectionRepo.findOne.mockResolvedValueOnce(notMine);
            await expect(
                service.updateSettings("owner-1", 20, {
                    isAutoImportEnabled: true,
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.NOT_FOUND,
            });
        });

        it("rejects with HTTP 400 if autoImportCollectionId belongs to another user", async () => {
            const existing = {
                id: 15,
                profileUserId: "owner-1",
            } as UserConnection;
            userConnectionRepo.findOne.mockResolvedValueOnce(existing);
            collectionsService.findOneById.mockResolvedValueOnce({
                id: "not-my-col",
                libraryUserId: "intruder-user",
            });

            await expect(
                service.updateSettings("owner-1", 15, {
                    autoImportCollectionId: "not-my-col",
                }),
            ).rejects.toMatchObject({
                status: HttpStatus.BAD_REQUEST,
            });
        });
    });
});
