import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GamePlaytime } from "./entity/game-playtime.entity";
import { DeepPartial, Repository } from "typeorm";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import { days } from "@nestjs/throttler";

const MINIMUM_UPDATE_INTERVAL_MS = days(30);
const FAILED_ATTEMPT_TTL_MS = days(7);

@Injectable()
export class HltbService {
    constructor(
        @InjectRepository(GamePlaytime)
        private gamePlaytimeRepository: Repository<GamePlaytime>,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
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

    private async hasFailedAttempt(gameId: number) {
        const attempt = await this.cacheManager.get<boolean>(
            `hltb-failed-attempt-${gameId}`,
        );
        return attempt != undefined;
    }

    public async isEligibleForUpdate(gameId: number) {
        const playtime = await this.findOneByGameId(gameId);
        const failedAttempt = await this.hasFailedAttempt(gameId);
        if (playtime && playtime.updatedAt) {
            const now = new Date();
            const lastUpdate = playtime.updatedAt;
            return (
                lastUpdate.getTime() - now.getTime() >
                MINIMUM_UPDATE_INTERVAL_MS
            );
        } else if (failedAttempt) {
            return false;
        }

        return true;
    }

    public async save(entity: DeepPartial<GamePlaytime>) {
        entity.updatedAt = new Date();
        return await this.gamePlaytimeRepository.save(entity);
    }

    public registerFailedAttempt(gameId: number) {
        this.cacheManager
            .set(`hltb-failed-attempt-${gameId}`, true, FAILED_ATTEMPT_TTL_MS)
            .then()
            .catch(console.error);
    }
}
