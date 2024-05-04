import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserConnection } from "./entity/user-connection.entity";
import { Repository } from "typeorm";
import { EConnectionType } from "./connections.constants";
import { ConnectionCreateDto } from "./dto/connection-create.dto";

@Injectable()
export class ConnectionsService {
    constructor(
        @InjectRepository(UserConnection)
        private readonly userConnectionRepository: Repository<UserConnection>,
    ) {}

    public findOneById(id: number) {
        return this.userConnectionRepository.findOneBy({
            id,
        });
    }

    public findOneByUserIdAndType(userId: string, type: EConnectionType) {
        return this.userConnectionRepository.findOneBy({
            type,
            profileUserId: userId,
        });
    }

    public async findOneByUserIdAndTypeOrFail(
        userId: string,
        type: EConnectionType,
    ): Promise<UserConnection> {
        const entity = await this.findOneByUserIdAndType(userId, type);
        if (!entity) {
            throw new HttpException(
                "No connection found for the given parameters.",
                HttpStatus.NOT_FOUND,
            );
        }

        return entity;
    }

    public async createOrUpdate(userId: string, dto: ConnectionCreateDto) {
        const { type, sourceUsername, sourceUserId } = dto;
        if (
            (sourceUsername == undefined && sourceUserId == undefined) ||
            (sourceUsername.length === 0 && sourceUserId.length === 0)
        ) {
            throw new HttpException(
                "sourceUsername and sourceUserId can't both be empty.",
                HttpStatus.BAD_REQUEST,
            );
        }

        const possibleExistingConnection = await this.findOneByUserIdAndType(
            userId,
            type,
        );

        await this.userConnectionRepository.save({
            ...possibleExistingConnection,
            type,
            profileUserId: userId,
            sourceUserId,
            sourceUsername: sourceUsername,
        });
    }

    public async delete(userId: string, id: number) {
        return await this.userConnectionRepository.delete({
            id,
            profileUserId: userId,
        });
    }
}
