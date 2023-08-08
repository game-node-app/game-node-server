import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { FindOptionsRelations, Repository } from "typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { TStatisticsCounterAction } from "./statistics.types";
import { FindPopularDto } from "./dto/find-popular.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";

@Injectable()
export class StatisticsGameService {
    private relations: FindOptionsRelations<GameStatistics> = {
        likes: true,
        views: true,
    };

    constructor(
        @InjectRepository(GameStatistics)
        private gameStatisticsRepository: Repository<GameStatistics>,
        @InjectRepository(UserLike)
        private userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private userViewRepository: Repository<UserView>,
    ) {}

    async findOneById(igdbId: number) {
        return await this.gameStatisticsRepository.findOne({
            where: {
                igdbId,
            },
            relations: this.relations,
        });
    }

    async findAllByMostPopular(dto?: FindPopularDto) {
        const options = buildBaseFindOptions<GameStatistics>(dto);
        options.relations = {
            ...this.relations,
        };
        return await this.gameStatisticsRepository.findAndCount(options);
    }

    async handleGameStatisticsViews(igdbId: number, userId?: string) {
        let gameStatistics = await this.gameStatisticsRepository.findOne({
            where: {
                igdbId,
            },
        });

        if (!gameStatistics) {
            // Keep in mind that .save() doesn't return relations, even if they were present on the entity object.
            gameStatistics = await this.gameStatisticsRepository.save({
                igdbId,
            });
        }

        // gameStatisticsId is stored on the UserView side:
        // This single insert will make it available on the GameStatistics side
        await this.userViewRepository.insert({
            userId: userId || undefined,
            gameStatistics: gameStatistics,
        });
    }

    async handleGameStatisticsLikes(
        igdbId: number,
        userId: string,
        action: TStatisticsCounterAction,
    ) {
        let gameStatistics = await this.gameStatisticsRepository.findOne({
            where: {
                igdbId,
            },
        });

        if (!gameStatistics) {
            // Keep in mind that .save() doesn't return relations, even if they were present on the entity object.
            gameStatistics = await this.gameStatisticsRepository.save({
                igdbId,
            });
        }

        if (action === "increment") {
            const userHasLiked = await this.userLikeRepository.count({
                where: {
                    userId,
                    gameStatistics: gameStatistics,
                },
            });
            if (userHasLiked) {
                return;
            }
            // gameStatisticsId is stored on the UserLikes side:
            // This single insert will make it available on the GameStatistics side
            await this.userLikeRepository.insert({
                userId,
                gameStatistics: gameStatistics,
            });
        } else {
            await this.userLikeRepository.delete({
                userId,
                gameStatistics: gameStatistics,
            });
        }
    }
}
