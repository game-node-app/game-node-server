import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GamePlaytime } from "./entity/game-playtime.entity";
import { DeepPartial, Repository } from "typeorm";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class HltbService {
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

    public async isEligibleForUpdate(gameId: number) {
        const playtime = await this.findOneByGameId(gameId);
        if (playtime && playtime.updatedAt) {
            const now = new Date();
            const lastUpdate = playtime.updatedAt;
            return lastUpdate.getTime() - now.getTime() > THIRTY_DAYS_MS;
        }

        return true;
    }

    public async save(entity: DeepPartial<GamePlaytime>) {
        entity.updatedAt = new Date();
        return await this.gamePlaytimeRepository.save(entity);
    }
}
