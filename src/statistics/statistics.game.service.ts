import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { Repository } from "typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { TStatisticsCounterAction } from "./statistics.types";

@Injectable()
export class StatisticsGameService {
    constructor(
        @InjectRepository(GameStatistics)
        private gameStatisticsRepository: Repository<GameStatistics>,
        @InjectRepository(UserLike)
        private userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private userViewRepository: Repository<UserView>,
    ) {}

    async handleGameStatisticsViews(igdbId: number, userId?: string) {
        let gameStatistics = await this.gameStatisticsRepository.findOne({
            where: {
                igdbId,
            },
        });

        if (!gameStatistics) {
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
