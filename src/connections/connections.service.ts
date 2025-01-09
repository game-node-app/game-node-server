import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserConnection } from "./entity/user-connection.entity";
import { In, Repository } from "typeorm";
import {
    EConnectionType,
    IMPORTER_VIABLE_CONNECTIONS,
    IMPORTER_WATCH_VIABLE_CONNECTIONS,
    PLAYTIME_WATCH_VIABLE_CONNECTIONS,
} from "./connections.constants";
import { ConnectionCreateDto } from "./dto/connection-create.dto";
import { SteamSyncService } from "../sync/steam/steam-sync.service";
import { FindAvailableConnectionsResponseDto } from "./dto/find-available-connections-response.dto";
import { PsnSyncService } from "../sync/psn/psn-sync.service";
import { UserConnectionDto } from "./dto/user-connection.dto";

const toDto = (userConnection: UserConnection): UserConnectionDto => ({
    ...userConnection,
    isImporterViable: IMPORTER_VIABLE_CONNECTIONS.includes(userConnection.type),
    isImporterWatchViable: IMPORTER_WATCH_VIABLE_CONNECTIONS.includes(
        userConnection.type,
    ),
    isPlaytimeWatchViable: PLAYTIME_WATCH_VIABLE_CONNECTIONS.includes(
        userConnection.type,
    ),
});

@Injectable()
export class ConnectionsService {
    constructor(
        @InjectRepository(UserConnection)
        private readonly userConnectionRepository: Repository<UserConnection>,
        private readonly steamSyncService: SteamSyncService,
        private readonly psnSyncService: PsnSyncService,
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
                    isPlaytimeWatchViable:
                        PLAYTIME_WATCH_VIABLE_CONNECTIONS.includes(type),
                    name: type.valueOf(),
                    iconName: type.valueOf(),
                };
            },
        );
    }

    public async createOrUpdate(userId: string, dto: ConnectionCreateDto) {
        const { type, userIdentifier, isImporterEnabled } = dto;

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
            default:
                throw new HttpException(
                    "Invalid connection type",
                    HttpStatus.BAD_REQUEST,
                );
        }

        const isImporterViable = IMPORTER_VIABLE_CONNECTIONS.includes(type);
        const finalIsImporterEnabled = isImporterViable
            ? isImporterEnabled
            : false;

        await this.userConnectionRepository.save({
            ...possibleExistingConnection,
            type,
            profileUserId: userId,
            sourceUserId,
            sourceUsername: sourceUsername,
            isImporterViable,
            isImporterEnabled: finalIsImporterEnabled,
        });
    }

    public async delete(userId: string, id: number) {
        return await this.userConnectionRepository.delete({
            id,
            profileUserId: userId,
        });
    }
}
