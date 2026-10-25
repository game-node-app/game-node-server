import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { EConnectionAuthMode, EConnectionType } from "./connections.constants";
import { HttpStatus } from "@nestjs/common";

describe("ConnectionProviderRegistry", () => {
    let registry: ConnectionProviderRegistry;

    beforeEach(() => {
        registry = new ConnectionProviderRegistry();
    });

    it("should discover registered providers (steam, psn, xbox) and return their capabilities", () => {
        const available = registry.getAvailableProviders();
        expect(available.length).toBe(3);

        const steam = available.find((p) => p.type === EConnectionType.STEAM);
        expect(steam).toBeDefined();
        expect(steam?.authMode).toBe(EConnectionAuthMode.REDIRECT);
        expect(steam?.isAchievementImportViable).toBe(true);
        expect(steam?.isImporterViable).toBe(true);

        const psn = available.find((p) => p.type === EConnectionType.PSN);
        expect(psn).toBeDefined();
        expect(psn?.authMode).toBe(EConnectionAuthMode.PUBLIC_IDENTIFIER);
        expect(psn?.isAchievementImportViable).toBe(false);

        const xbox = available.find((p) => p.type === EConnectionType.XBOX);
        expect(xbox).toBeDefined();
        expect(xbox?.authMode).toBe(EConnectionAuthMode.REDIRECT);
    });

    it("should reject unknown providers with HTTP 400", () => {
        expect(registry.has("nintendo" as any)).toBe(false);
        expect(() => registry.get("nintendo" as any)).toThrow(
            expect.objectContaining({
                status: HttpStatus.BAD_REQUEST,
            }),
        );
    });

    it("should allow registering auth strategies and sync handlers", () => {
        const fakeStrategy = {
            initRedirectAuth: jest.fn(),
            completeRedirectAuth: jest.fn(),
        };
        registry.registerAuthStrategy(EConnectionType.STEAM, fakeStrategy);
        const steam = registry.get(EConnectionType.STEAM);
        expect(steam.authStrategy).toBe(fakeStrategy);

        const fakeSyncHandlers = {
            fetchLibraryGames: jest.fn(),
        };
        registry.registerSyncHandlers(EConnectionType.XBOX, fakeSyncHandlers);
        const fetchPlaytime = jest.fn();
        registry.registerSyncHandlers(EConnectionType.XBOX, { fetchPlaytime });
        const xbox = registry.get(EConnectionType.XBOX);
        expect(xbox.syncHandlers).toEqual({
            ...fakeSyncHandlers,
            fetchPlaytime,
        });
    });
});
