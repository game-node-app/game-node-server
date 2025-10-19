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
    EConnectionType,
    IMPORTER_VIABLE_CONNECTIONS,
    IMPORTER_WATCH_VIABLE_CONNECTIONS,
    PLAYTIME_IMPORT_VIABLE_CONNECTIONS,
} from "./connections.constants";
import { ConnectionCreateDto } from "./dto/connection-create.dto";
import { SteamSyncService } from "../sync/steam/steam-sync.service";
import { FindAvailableConnectionsResponseDto } from "./dto/find-available-connections-response.dto";
import { PsnSyncService } from "../sync/psn/psn-sync.service";
import { UserConnectionDto } from "./dto/user-connection.dto";
import { HttpStatusCode } from "axios";
import { PlaytimeWatchService } from "../playtime/watch/playtime-watch.service";
import { XboxSyncService } from "../sync/xbox/xbox-sync.service";
import { CollectionsService } from "../collections/collections.service";

const toDto = (userConnection: UserConnection): UserConnectionDto => ({
    ...userConnection,
    isImporterViable: IMPORTER_VIABLE_CONNECTIONS.includes(userConnection.type),
    isImporterWatchViable: IMPORTER_WATCH_VIABLE_CONNECTIONS.includes(
        userConnection.type,
    ),
    isPlaytimeImportViable: PLAYTIME_IMPORT_VIABLE_CONNECTIONS.includes(
        userConnection.type,
    ),
});

@Injectable()
export class ConnectionsService {
    private readonly logger = new Logger(ConnectionsService.name);

    constructor(
        @InjectRepository(UserConnection)
        private readonly userConnectionRepository: Repository<UserConnection>,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
        private readonly xboxSyncService: XboxSyncService,
        @Inject(forwardRef(() => PlaytimeWatchService))
        private readonly playtimeWatchService: PlaytimeWatchService,
        @Inject(forwardRef(() => CollectionsService))
        private readonly collectionsService: CollectionsService,
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
        return Object.values(EConnectionType).map(
            (type): FindAvailableConnectionsResponseDto => {
                return {
                    type: type,
                    isImporterViable:
                        IMPORTER_VIABLE_CONNECTIONS.includes(type),
                    isImporterWatchViable:
                        IMPORTER_WATCH_VIABLE_CONNECTIONS.includes(type),
                    isPlaytimeImportViable:
                        PLAYTIME_IMPORT_VIABLE_CONNECTIONS.includes(type),
                    name: type.valueOf(),
                    iconName: type.valueOf(),
                };
            },
        );
    }

    public async createOrUpdate(userId: string, dto: ConnectionCreateDto) {
        const {
            type,
            userIdentifier,
            isImporterEnabled,
            isPlaytimeImportEnabled,
            isAutoImportEnabled,
            autoImportCollectionId,
        } = dto;

        const possibleExistingConnection = await this.findOneByUserIdAndType(
            userId,
            type,
        );

        let sourceUserId: string;
        let sourceUsername: string;

        switch (type) {
            case EConnectionType.STEAM: {
                const steamUserInfo =
                    await this.steamSyncService.resolveUserInfo(userIdentifier);
                sourceUserId = steamUserInfo.userId;
                sourceUsername = steamUserInfo.username;
                break;
            }
            case EConnectionType.PSN: {
                const psnUserInfo =
                    await this.psnSyncService.resolveUserInfo(userIdentifier);
                sourceUserId = psnUserInfo.userId;
                sourceUsername = psnUserInfo.username;
                break;
            }
            case EConnectionType.XBOX: {
                const xboxUserInfo =
                    await this.xboxSyncService.resolveUserInfo(userIdentifier);
                sourceUserId = xboxUserInfo.userId;
                sourceUsername = xboxUserInfo.username;
                break;
            }
            default:
                throw new HttpException(
                    "Invalid connection type",
                    HttpStatus.BAD_REQUEST,
                );
        }

        const isImporterViable = IMPORTER_VIABLE_CONNECTIONS.includes(type);
        const isPlaytimeImporterViable =
            PLAYTIME_IMPORT_VIABLE_CONNECTIONS.includes(type);

        const finalIsImporterEnabled = isImporterViable
            ? isImporterEnabled
            : false;
        const finalIsPlaytimeImportEnabled = isPlaytimeImporterViable
            ? isPlaytimeImportEnabled
            : false;
        const finalIsAutoImportEnabled = isImporterViable
            ? isAutoImportEnabled
            : false;

        // Validate collection exists and belongs to user if autoImportCollectionId is provided
        // If auto-import is enabled but no collection specified, games will be imported
        // to the user's library without being added to a specific collection
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

        const createdConnection = await this.userConnectionRepository.save({
            ...possibleExistingConnection,
            type,
            profileUserId: userId,
            sourceUserId,
            sourceUsername: sourceUsername,
            isImporterViable,
            isImporterEnabled: finalIsImporterEnabled,
            isPlaytimeImportEnabled: finalIsPlaytimeImportEnabled,
            isAutoImportEnabled: finalIsAutoImportEnabled,
            autoImportCollectionId: validatedAutoImportCollectionId,
        });

        this.onConnectionCreate(createdConnection);
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
        this.playtimeWatchService
            .registerJob(
                createdConnection.profileUserId,
                createdConnection.type,
            )
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
