import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import {
    ACHIEVEMENT_IMPORT_VIABLE_CONNECTIONS,
    EConnectionAuthMode,
    EConnectionType,
    IMPORTER_VIABLE_CONNECTIONS,
    IMPORTER_WATCH_VIABLE_CONNECTIONS,
    PLAYTIME_IMPORT_VIABLE_CONNECTIONS,
} from "./connections.constants";
import { FindAvailableConnectionsResponseDto } from "./dto/find-available-connections-response.dto";
import { ConnectionAuthState } from "./connection-auth-state.service";
import { PlaintextConnectionCredentials } from "./connection-credential.service";
import type { Job } from "bullmq";
import type { PlaytimeWatchJob } from "../playtime/watch/playtime-watch.constants";
import type { ImporterResponseItemDto } from "../importer/dto/importer-response-item.dto";
import type { GameExternalGame } from "../game/external-game/entity/game-external-game.entity";
import type { GameObtainedAchievementDto } from "../game/game-achievement/dto/game-obtained-achievement.dto";

export interface RedirectAuthInitParams {
    userId: string;
    state: string;
    isAutoImportEnabled?: boolean;
    autoImportCollectionId?: string | null;
}

export interface RedirectAuthInitResult {
    authorizationUrl: string;
    state?: string;
    codeVerifier?: string;
    metadata?: Record<string, any>;
}

export interface RedirectAuthCallbackResult {
    sourceUserId: string;
    sourceUsername: string;
    credentials?: PlaintextConnectionCredentials;
}

export interface PublicIdentifierResolveResult {
    sourceUserId: string;
    sourceUsername: string;
}

export interface ConnectionProviderAuthStrategy {
    initRedirectAuth?(
        params: RedirectAuthInitParams,
    ): Promise<RedirectAuthInitResult>;
    completeRedirectAuth?(
        callbackParams: Record<string, any>,
        savedState: ConnectionAuthState,
    ): Promise<RedirectAuthCallbackResult>;
    resolvePublicIdentifier?(
        userIdentifier: string,
    ): Promise<PublicIdentifierResolveResult>;
    exchangeDelegatedCode?(code: string): Promise<RedirectAuthCallbackResult>;
}

export interface ConnectionProviderSyncHandlers {
    fetchPlaytime?(
        job: Job<PlaytimeWatchJob>,
    ): Promise<{ outcome: string } | undefined>;
    fetchLibraryGames?(userId: string): Promise<ImporterResponseItemDto[]>;
    fetchObtainedAchievements?(
        userId: string,
        externalGame: GameExternalGame,
    ): Promise<GameObtainedAchievementDto[]>;
}

export interface ConnectionProviderMetadata {
    type: EConnectionType;
    name: string;
    iconName: string;
    authMode: EConnectionAuthMode;
    isImporterViable: boolean;
    isImporterWatchViable: boolean;
    isPlaytimeImportViable: boolean;
    isAchievementImportViable: boolean;
}

export interface ConnectionProviderDefinition
    extends ConnectionProviderMetadata {
    authStrategy?: ConnectionProviderAuthStrategy;
    syncHandlers?: ConnectionProviderSyncHandlers;
}

@Injectable()
export class ConnectionProviderRegistry {
    private readonly providers = new Map<
        string,
        ConnectionProviderDefinition
    >();

    constructor() {
        this.registerDefaultProviders();
    }

    private registerDefaultProviders(): void {
        this.register({
            type: EConnectionType.STEAM,
            name: EConnectionType.STEAM.valueOf(),
            iconName: EConnectionType.STEAM.valueOf(),
            authMode: EConnectionAuthMode.REDIRECT,
            isImporterViable: IMPORTER_VIABLE_CONNECTIONS.includes(
                EConnectionType.STEAM,
            ),
            isImporterWatchViable: IMPORTER_WATCH_VIABLE_CONNECTIONS.includes(
                EConnectionType.STEAM,
            ),
            isPlaytimeImportViable: PLAYTIME_IMPORT_VIABLE_CONNECTIONS.includes(
                EConnectionType.STEAM,
            ),
            isAchievementImportViable:
                ACHIEVEMENT_IMPORT_VIABLE_CONNECTIONS.includes(
                    EConnectionType.STEAM,
                ),
        });

        this.register({
            type: EConnectionType.PSN,
            name: EConnectionType.PSN.valueOf(),
            iconName: EConnectionType.PSN.valueOf(),
            authMode: EConnectionAuthMode.PUBLIC_IDENTIFIER,
            isImporterViable: IMPORTER_VIABLE_CONNECTIONS.includes(
                EConnectionType.PSN,
            ),
            isImporterWatchViable: IMPORTER_WATCH_VIABLE_CONNECTIONS.includes(
                EConnectionType.PSN,
            ),
            isPlaytimeImportViable: PLAYTIME_IMPORT_VIABLE_CONNECTIONS.includes(
                EConnectionType.PSN,
            ),
            isAchievementImportViable:
                ACHIEVEMENT_IMPORT_VIABLE_CONNECTIONS.includes(
                    EConnectionType.PSN,
                ),
        });

        this.register({
            type: EConnectionType.XBOX,
            name: EConnectionType.XBOX.valueOf(),
            iconName: EConnectionType.XBOX.valueOf(),
            authMode: EConnectionAuthMode.REDIRECT,
            isImporterViable: IMPORTER_VIABLE_CONNECTIONS.includes(
                EConnectionType.XBOX,
            ),
            isImporterWatchViable: IMPORTER_WATCH_VIABLE_CONNECTIONS.includes(
                EConnectionType.XBOX,
            ),
            isPlaytimeImportViable: PLAYTIME_IMPORT_VIABLE_CONNECTIONS.includes(
                EConnectionType.XBOX,
            ),
            isAchievementImportViable:
                ACHIEVEMENT_IMPORT_VIABLE_CONNECTIONS.includes(
                    EConnectionType.XBOX,
                ),
        });
    }

    public register(definition: ConnectionProviderDefinition): void {
        this.providers.set(definition.type, definition);
    }

    public has(type: EConnectionType | string): boolean {
        return this.providers.has(type);
    }

    public get(type: EConnectionType | string): ConnectionProviderDefinition {
        const provider = this.providers.get(type);
        if (!provider) {
            throw new HttpException(
                `Unsupported or unknown connection provider: ${type}`,
                HttpStatus.BAD_REQUEST,
            );
        }
        return provider;
    }

    public getAll(): ConnectionProviderDefinition[] {
        return Array.from(this.providers.values());
    }

    public getAvailableProviders(): FindAvailableConnectionsResponseDto[] {
        return this.getAll().map((provider) => ({
            type: provider.type,
            name: provider.name,
            iconName: provider.iconName,
            authMode: provider.authMode,
            isImporterViable: provider.isImporterViable,
            isImporterWatchViable: provider.isImporterWatchViable,
            isPlaytimeImportViable: provider.isPlaytimeImportViable,
            isAchievementImportViable: provider.isAchievementImportViable,
        }));
    }

    public registerAuthStrategy(
        type: EConnectionType,
        strategy: ConnectionProviderAuthStrategy,
    ): void {
        const provider = this.get(type);
        provider.authStrategy = strategy;
    }

    public registerSyncHandlers(
        type: EConnectionType,
        handlers: ConnectionProviderSyncHandlers,
    ): void {
        const provider = this.get(type);
        provider.syncHandlers = { ...provider.syncHandlers, ...handlers };
    }
}
