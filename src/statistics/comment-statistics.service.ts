import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CommentStatistics } from "./entity/comment-statistics.entity";
import { StatisticsService } from "./statistics.types";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { FindOptionsWhere, Repository } from "typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import { StatisticsSourceType } from "./statistics.constants";

type CommentEntityKeys = keyof (typeof CommentStatistics)["prototype"];

@Injectable()
export class CommentStatisticsService implements StatisticsService {
    constructor(
        @InjectRepository(CommentStatistics)
        private readonly commentStatisticsRepository: Repository<CommentStatistics>,
        @InjectRepository(UserLike)
        private userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private userViewRepository: Repository<UserView>,
        private notificationsQueueService: NotificationsQueueService,
    ) {}

    async create(data: StatisticsCreateAction): Promise<CommentStatistics> {
        const { sourceId, sourceType } = data;
        if (typeof sourceId !== "string") {
            throw new Error("Invalid sourceId type for comment statistics");
        }
        let targetRelationProperty: CommentEntityKeys;
        switch (sourceType) {
            case StatisticsSourceType.REVIEW_COMMENT:
                targetRelationProperty = "reviewCommentId";
                break;
            default:
                throw new Error("Invalid source type for comment statistics");
        }

        const existingEntry = await this.commentStatisticsRepository.findOneBy({
            [targetRelationProperty]: sourceId,
        });

        if (existingEntry) {
            return existingEntry;
        }

        return await this.commentStatisticsRepository.save({
            [targetRelationProperty]: sourceId,
        });
    }

    findOne(
        sourceId: string | number,
    ): Promise<GameStatistics | ReviewStatistics | ActivityStatistics | null> {
        return Promise.resolve(undefined);
    }

    findTrending(
        data: any,
    ): Promise<
        TPaginationData<GameStatistics | ReviewStatistics | ActivityStatistics>
    > {
        return Promise.resolve(undefined);
    }

    getStatus(
        statisticsId: number,
        userId: string | undefined,
    ): Promise<StatisticsStatus> {
        return Promise.resolve(undefined);
    }

    handleLike(data: StatisticsLikeAction): Promise<void> {
        return Promise.resolve(undefined);
    }

    handleView(data: StatisticsViewAction): Promise<void> {
        return Promise.resolve(undefined);
    }
}
