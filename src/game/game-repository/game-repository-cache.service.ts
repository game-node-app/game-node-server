import { Inject, Injectable, Logger } from "@nestjs/common";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import { FindManyOptions, FindOneOptions, Repository } from "typeorm";
import { Game } from "./entities/game.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { minutes } from "@nestjs/throttler";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";

/**
 * Adds a cache layer for calls to game's entity repository <br>
 * Necessary because TypeORM's cache tend to miss.
 * @param options
 * @param ttl
 */
@Injectable()
export class GameRepositoryCacheService {
    private readonly logger = new Logger(GameRepositoryCacheService.name);

    constructor(
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    ) {}

    async find(
        options: Omit<FindManyOptions<Game>, "cache">,
        ttl: number = minutes(5),
    ) {
        const cacheKey = JSON.stringify(options);
        const itemsInCache = await this.cacheManager.get<Game[]>(cacheKey);

        if (itemsInCache) return itemsInCache;

        const items = await this.gameRepository.find(options);

        this.cacheManager.set(cacheKey, items, ttl).catch((err) => {
            this.logger.error(err);
        });

        return items;
    }

    async findAndCount(
        options: Omit<FindManyOptions<Game>, "cache">,
        ttl: number = minutes(5),
    ) {
        const cacheKey = JSON.stringify(options);
        const itemsInCache =
            await this.cacheManager.get<TPaginationData<Game>>(cacheKey);

        if (itemsInCache) return itemsInCache;

        const items = await this.gameRepository.findAndCount(options);

        this.cacheManager.set(cacheKey, items, ttl).catch((err) => {
            this.logger.error(err);
        });

        return items;
    }

    async findOne(
        options: Omit<FindOneOptions<Game>, "cache">,
        ttl: number = minutes(1),
    ) {
        const cacheKey = JSON.stringify(options);
        const itemInCache = await this.cacheManager.get<Game>(cacheKey);

        if (itemInCache) return itemInCache;

        const items = await this.gameRepository.findOne(options);

        this.cacheManager.set(cacheKey, items, ttl).catch((err) => {
            this.logger.error(err);
        });

        return items;
    }
}
