import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { Between, FindOptionsRelations, Repository } from "typeorm";
import { UserLike } from "../entity/user-like.entity";
import { UserView } from "../entity/user-view.entity";
import { TStatisticsCounterAction } from "./statistics-game.types";
import { FindTrendingStatisticsDto } from "./dto/find-trending-statistics-dto";

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

    async findOneByGameId(gameId: number) {
        return await this.gameStatisticsRepository.findOne({
            where: {
                game: {
                    id: gameId,
                },
            },
            relations: this.relations,
        });
    }

    async findTrending(dto?: FindTrendingStatisticsDto | undefined) {
        const today = new Date();
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);

        return await this.gameStatisticsRepository.find({
            where: [
                {
                    views: {
                        createdAt: Between(lastWeek, today),
                    },
                },
                {
                    likes: {
                        createdAt: Between(lastWeek, today),
                    },
                },
            ],
            order: {
                viewsCount: "DESC",
                likesCount: "DESC",
            },
            relations: dto?.relations,
            take: dto && dto.limit ? dto.limit : 5,
        });
    }

    async handleGameStatisticsViews(igdbId: number, userId?: string) {
        let gameStatistics = await this.gameStatisticsRepository.findOne({
            where: {
                game: {
                    id: igdbId,
                },
            },
        });

        if (!gameStatistics) {
            // Keep in mind that .save() doesn't return relations, even if they were present on the entity object.
            gameStatistics = await this.gameStatisticsRepository.save({
                game: {
                    id: igdbId,
                },
            });
        }

        await this.userViewRepository.insert({
            userId: userId || undefined,
            gameStatistics: gameStatistics,
        });
        await this.gameStatisticsRepository.increment(
            {
                id: gameStatistics.id,
            },
            "viewsCount",
            1,
        );
    }

    async handleGameStatisticsLikes(
        gameId: number,
        userId: string,
        action: TStatisticsCounterAction,
    ) {
        let gameStatistics = await this.gameStatisticsRepository.findOne({
            where: {
                game: {
                    id: gameId,
                },
            },
        });

        if (!gameStatistics) {
            // Keep in mind that .save() doesn't return relations, even if they were present on the entity object.
            gameStatistics = await this.gameStatisticsRepository.save({
                game: {
                    id: gameId,
                },
            });
        }

        if (action === "increment") {
            const userHasLiked = await this.userLikeRepository.count({
                where: {
                    userId: userId,
                    gameStatistics: {
                        id: gameStatistics.id,
                    },
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
            await this.gameStatisticsRepository.increment(
                {
                    id: gameStatistics.id,
                },
                "likesCount",
                1,
            );
        } else {
            await this.userLikeRepository.delete({
                userId: userId,
                gameStatistics: {
                    id: gameStatistics.id,
                },
            });
            await this.gameStatisticsRepository.decrement(
                {
                    id: gameStatistics.id,
                },
                "likesCount",
                1,
            );
        }
    }
}
