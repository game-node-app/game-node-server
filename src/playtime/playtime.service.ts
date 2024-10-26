import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GamePlaytime } from "./entity/game-playtime.entity";
import { DeepPartial, In, Repository } from "typeorm";
import { toMap } from "../utils/toMap";

@Injectable()
export class PlaytimeService {
    private logger = new Logger(PlaytimeService.name);

    constructor(
        @InjectRepository(GamePlaytime)
        private gamePlaytimeRepository: Repository<GamePlaytime>,
    ) {}

    public async findOneByGameId(gameId: number) {
        return await this.gamePlaytimeRepository.findOneBy({
            gameId,
        });
    }

    public async findOneByGameIdOrFail(gameId: number) {
        const entity = await this.findOneByGameId(gameId);
        if (!entity) {
            throw new HttpException(
                "No playtime info found for game.",
                HttpStatus.BAD_REQUEST,
            );
        }

        return entity;
    }

    public async findAllByGameIds(gameIds: number[]) {
        return this.gamePlaytimeRepository.find({
            where: {
                gameId: In(gameIds),
            },
        });
    }

    /**
     * Shorthand method that transforms the result of 'findAllByGameIds'
     * in a map where the 'gameId' is the key.
     * @see PlaytimeService#findAllByGameIds
     * @param gameIds
     */
    public async getPlaytimesMap(gameIds: number[]) {
        const playtimes = await this.findAllByGameIds(gameIds);

        return toMap(playtimes, "gameId");
    }

    public async save(entity: DeepPartial<GamePlaytime>) {
        if (entity.gameId == undefined) {
            this.logger.warn(
                `Ignoring attempt to save entity with undefined gameId: ${JSON.stringify(entity)}`,
            );
            return;
        }
        const playtimeInfo = await this.findOneByGameId(entity.gameId);

        const updatedEntity: DeepPartial<GamePlaytime> = {
            ...playtimeInfo,
            ...entity,
            updatedAt: new Date(),
        };

        await this.gamePlaytimeRepository.save(updatedEntity);
    }
}
