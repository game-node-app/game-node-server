import { runInTransaction } from "typeorm-transactional";
import { PlayerSyncStateService } from "../sync/player-data/player-sync-state.service";
import {
    forwardRef,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserConnection } from "./entity/user-connection.entity";
import { In, Repository } from "typeorm";
import {
    ACHIEVEMENT_IMPORT_VIABLE_CONNECTIONS,
    EConnectionAuthMode,
    EConnectionAuthStatus,
    EConnectionType,
    IMPORTER_VIABLE_CONNECTIONS,
    IMPORTER_WATCH_VIABLE_CONNECTIONS,
    PLAYTIME_IMPORT_VIABLE_CONNECTIONS,
} from "./connections.constants";
import { ConnectionCreateDto } from "./dto/connection-create.dto";
import { FindAvailableConnectionsResponseDto } from "./dto/find-available-connections-response.dto";
import { UserConnectionDto } from "./dto/user-connection.dto";
import { HttpStatusCode } from "axios";
import { PlaytimeWatchService } from "../playtime/watch/playtime-watch.service";
import { CollectionsService } from "../collections/collections.service";
import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { ConnectionAuthStateService } from "./connection-auth-state.service";
import { ConnectionCredentialService } from "./connection-credential.service";
import {
    ConnectionAuthInitDto,
    ConnectionAuthInitResponseDto,
} from "./dto/connection-auth-init.dto";
import { ConnectionAuthCallbackDto } from "./dto/connection-auth-callback.dto";
import { ConnectionSettingsUpdateDto } from "./dto/connection-settings-update.dto";
import * as crypto from "node:crypto";

export const toDto = (userConnection: UserConnection): UserConnectionDto => ({
    id: userConnection.id,
    type: userConnection.type,
    profileUserId: userConnection.profileUserId,
    sourceUserId: userConnection.sourceUserId,
    sourceUsername: userConnection.sourceUsername,
    isAutoImportEnabled: userConnection.isAutoImportEnabled,
    autoImportCollectionId: userConnection.autoImportCollectionId,
    autoImportCollection: userConnection.autoImportCollection,
    authStatus: userConnection.authStatus ?? EConnectionAuthStatus.CONNECTED,
    isImporterViable: IMPORTER_VIABLE_CONNECTIONS.includes(userConnection.type),
    isImporterWatchViable: IMPORTER_WATCH_VIABLE_CONNECTIONS.includes(
        userConnection.type,
    ),
    isPlaytimeImportViable: PLAYTIME_IMPORT_VIABLE_CONNECTIONS.includes(
        userConnection.type,
    ),
    isAchievementImportViable: ACHIEVEMENT_IMPORT_VIABLE_CONNECTIONS.includes(
        userConnection.type,
    ),
});

@Injectable()
export class ConnectionsService {
    private readonly logger = new Logger(ConnectionsService.name);

    constructor(
        @InjectRepository(UserConnection)
        private readonly userConnectionRepository: Repository<UserConnection>,
        @Inject(forwardRef(() => PlaytimeWatchService))
        private readonly playtimeWatchService: PlaytimeWatchService,
        @Inject(forwardRef(() => CollectionsService))
        private readonly collectionsService: CollectionsService,
        private readonly syncState: PlayerSyncStateService,
        private readonly providerRegistry: ConnectionProviderRegistry,
        private readonly authStateService: ConnectionAuthStateService,
        private readonly credentialService: ConnectionCredentialService,
    ) {}

    public findOneById(id: number) {
        return this.userConnectionRepository.findOneBy({
            id,
        });
    }

    public async findOneByUserIdAndType(userId: string, type: EConnectionType) {
        const connection = await this.userConnectionRepository.findOneBy({
            type,
            profileUserId: userId,
        });

        if (!connection) return null;

        return toDto(connection);
    }

    public async findOneByUserIdAndTypeOrFail(
        userId: string,
        type: EConnectionType,
    ): Promise<UserConnectionDto> {
        const entity = await this.findOneByUserIdAndType(userId, type);
        if (!entity) {
            throw new HttpException(
                "No connection found for the given parameters.",
                HttpStatus.NOT_FOUND,
            );
        }

        return entity;
    }

    public async findAllByUserId(userId: string): Promise<UserConnectionDto[]> {
        const connections = await this.userConnectionRepository.findBy({
            profileUserId: userId,
        });

        return connections.map(toDto);
    }

    public async findAllByUserIdIn(userIds: string[]) {
        const connections = await this.userConnectionRepository.findBy({
            profileUserId: In(userIds),
        });

        return connections.map(toDto);
    }

    public async findAvailableConnections(): Promise<
        FindAvailableConnectionsResponseDto[]
    > {
        return this.providerRegistry.getAvailableProviders();
    }

    public async createOrUpdate(userId: string, dto: ConnectionCreateDto) {
        const {
            type,
            userIdentifier,
            isAutoImportEnabled,
            autoImportCollectionId,
        } = dto;

        const provider = this.providerRegistry.get(type);
        if (provider.authMode !== EConnectionAuthMode.PUBLIC_IDENTIFIER) {
            throw new HttpException(
                `Manual userIdentifier onboarding is only supported for public_identifier providers (e.g. psn). Use redirect authentication for ${type}.`,
                HttpStatus.BAD_REQUEST,
            );
        }

        let sourceUserId: string;
        let sourceUsername: string;

        if (provider.authStrategy?.resolvePublicIdentifier) {
            const resolved =
                await provider.authStrategy.resolvePublicIdentifier(
                    userIdentifier,
                );
            sourceUserId = resolved.sourceUserId;
            sourceUsername = resolved.sourceUsername;
        } else {
            throw new HttpException(
                "Unable to resolve public identifier for provider",
                HttpStatus.BAD_REQUEST,
            );
        }

        const isImporterViable = provider.isImporterViable;
        const finalIsAutoImportEnabled = isImporterViable
            ? isAutoImportEnabled
            : false;

        let validatedAutoImportCollectionId: string | null = null;
        if (finalIsAutoImportEnabled && autoImportCollectionId) {
            const collection = await this.collectionsService.findOneById(
                autoImportCollectionId,
            );
            if (!collection || collection.libraryUserId !== userId) {
                throw new HttpException(
                    "Collection not found or does not belong to user",
                    HttpStatus.BAD_REQUEST,
                );
            }
            validatedAutoImportCollectionId = autoImportCollectionId;
        }

        const createdConnection = await runInTransaction(async () => {
            const latest = await this.userConnectionRepository.findOne({
                where: { profileUserId: userId, type },
                lock: { mode: "pessimistic_write" },
            });
            const saved = await this.userConnectionRepository.save({
                ...latest,
                type,
                profileUserId: userId,
                sourceUserId,
                sourceUsername,
                isAutoImportEnabled: finalIsAutoImportEnabled,
                autoImportCollectionId: validatedAutoImportCollectionId,
                authStatus: EConnectionAuthStatus.CONNECTED,
            });
            await this.syncState.initialize(
                saved.id,
                saved.sourceUserId,
                new Date(),
            );
            return saved;
        });

        await this.onConnectionCreate(createdConnection);
    }

    public async initRedirectAuth(
        userId: string,
        type: EConnectionType,
        dto: ConnectionAuthInitDto,
    ): Promise<ConnectionAuthInitResponseDto> {
        const provider = this.providerRegistry.get(type);
        if (provider.authMode !== EConnectionAuthMode.REDIRECT) {
            throw new HttpException(
                `Provider ${type} does not support redirect authentication`,
                HttpStatus.BAD_REQUEST,
            );
        }
        if (!provider.authStrategy?.initRedirectAuth) {
            throw new HttpException(
                `Provider ${type} redirect authentication strategy is not implemented`,
                HttpStatus.BAD_REQUEST,
            );
        }

        let validatedCollectionId: string | null = null;
        if (dto.autoImportCollectionId) {
            const collection = await this.collectionsService.findOneById(
                dto.autoImportCollectionId,
            );
            if (!collection || collection.libraryUserId !== userId) {
                throw new HttpException(
                    "Collection not found or does not belong to user",
                    HttpStatus.BAD_REQUEST,
                );
            }
            validatedCollectionId = dto.autoImportCollectionId;
        }

        const state = crypto.randomBytes(32).toString("hex");
        const strategyResult = await provider.authStrategy.initRedirectAuth({
            userId,
            state,
            isAutoImportEnabled: dto.isAutoImportEnabled,
            autoImportCollectionId: validatedCollectionId,
        });

        const finalState = strategyResult.state || state;
        await this.authStateService.initState(
            {
                userId,
                type,
                isAutoImportEnabled: dto.isAutoImportEnabled,
                autoImportCollectionId: validatedCollectionId,
                codeVerifier: strategyResult.codeVerifier,
                metadata: strategyResult.metadata,
            },
            finalState,
        );

        return {
            authorizationUrl: strategyResult.authorizationUrl,
            state: finalState,
        };
    }

    public async completeRedirectAuth(
        userId: string,
        type: EConnectionType,
        dto: ConnectionAuthCallbackDto,
    ): Promise<UserConnectionDto> {
        const provider = this.providerRegistry.get(type);
        if (provider.authMode !== EConnectionAuthMode.REDIRECT) {
            throw new HttpException(
                `Provider ${type} does not support redirect authentication`,
                HttpStatus.BAD_REQUEST,
            );
        }
        if (!provider.authStrategy?.completeRedirectAuth) {
            throw new HttpException(
                `Provider ${type} redirect authentication strategy is not implemented`,
                HttpStatus.BAD_REQUEST,
            );
        }

        const storedState = await this.authStateService.consumeState(
            dto.state,
            userId,
            type,
        );

        const authResult = await provider.authStrategy.completeRedirectAuth(
            dto.callbackParams,
            storedState,
        );

        const createdConnection = await runInTransaction(async () => {
            const latest = await this.userConnectionRepository.findOne({
                where: { profileUserId: userId, type },
                lock: { mode: "pessimistic_write" },
            });
            const saved = await this.userConnectionRepository.save({
                ...latest,
                type,
                profileUserId: userId,
                sourceUserId: authResult.sourceUserId,
                sourceUsername: authResult.sourceUsername,
                isAutoImportEnabled: storedState.isAutoImportEnabled ?? false,
                autoImportCollectionId:
                    storedState.autoImportCollectionId ?? null,
                authStatus: EConnectionAuthStatus.CONNECTED,
            });

            if (authResult.credentials) {
                await this.credentialService.saveCredentials(
                    saved.id,
                    authResult.credentials,
                );
            }

            await this.syncState.initialize(
                saved.id,
                saved.sourceUserId,
                new Date(),
                true,
            );
            return saved;
        });

        await this.onConnectionCreate(createdConnection);
        return toDto(createdConnection);
    }

    public async updateSettings(
        userId: string,
        id: number,
        dto: ConnectionSettingsUpdateDto,
    ): Promise<UserConnectionDto> {
        const connection = await this.userConnectionRepository.findOne({
            where: { id },
        });

        if (!connection || connection.profileUserId !== userId) {
            throw new HttpException(
                "No connection found for the given criteria.",
                HttpStatus.NOT_FOUND,
            );
        }

        if (
            dto.autoImportCollectionId !== undefined &&
            dto.autoImportCollectionId !== null
        ) {
            const collection = await this.collectionsService.findOneById(
                dto.autoImportCollectionId,
            );
            if (!collection || collection.libraryUserId !== userId) {
                throw new HttpException(
                    "Collection not found or does not belong to user",
                    HttpStatus.BAD_REQUEST,
                );
            }
            connection.autoImportCollectionId = dto.autoImportCollectionId;
        } else if (dto.autoImportCollectionId === null) {
            connection.autoImportCollectionId = null;
        }

        if (dto.isAutoImportEnabled !== undefined) {
            connection.isAutoImportEnabled = dto.isAutoImportEnabled;
        }

        const saved = await this.userConnectionRepository.save(connection);
        return toDto(saved);
    }

    public async delete(userId: string, id: number) {
        const connection = await this.findOneById(id);

        if (!connection || connection.profileUserId !== userId) {
            throw new HttpException(
                "No connection found for the given criteria.",
                HttpStatusCode.NotFound,
            );
        }

        await this.userConnectionRepository.delete({
            id,
            profileUserId: userId,
        });
    }

    private onConnectionCreate(createdConnection: UserConnection) {
        return this.playtimeWatchService
            .registerJob(
                createdConnection.profileUserId,
                createdConnection.type,
            )
            .catch((err) => {
                this.logger.error(err);
                throw err;
            });
    }
}
