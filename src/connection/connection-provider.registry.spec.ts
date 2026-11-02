import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { EConnectionAuthMode, EConnectionType } from "./connections.constants";
import { HttpStatus } from "@nestjs/common";

describe("ConnectionProviderRegistry", () => {
    let registry: ConnectionProviderRegistry;

    beforeEach(() => {
        registry = new ConnectionProviderRegistry();
    });

    it("should discover registered providers (steam, psn, xbox, epicgames, nintendo) and return their capabilities", () => {
        const available = registry.getAvailableProviders();
        expect(available.length).toBe(5);

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

        const epic = available.find(
            (p) => p.type === EConnectionType.EPIC_GAMES,
        );
        expect(epic).toEqual({
            type: "epicgames",
            name: "epicgames",
            iconName: "epicgames",
            authMode: EConnectionAuthMode.DELEGATED_CODE,
            isImporterViable: true,
            isImporterWatchViable: true,
            isPlaytimeImportViable: true,
            isAchievementImportViable: false,
        });

        expect(
            available.find((p) => p.type === EConnectionType.NINTENDO),
        ).toEqual({
            type: "nintendo",
            name: "nintendo",
            iconName: "nintendo",
            authMode: EConnectionAuthMode.DELEGATED_CODE,
            isImporterViable: true,
            isImporterWatchViable: true,
            isPlaytimeImportViable: true,
            isAchievementImportViable: false,
        });
    });

    it("should reject unknown providers with HTTP 400", () => {
        expect(registry.has("future" as any)).toBe(false);
        expect(() => registry.get("future" as any)).toThrow(
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
