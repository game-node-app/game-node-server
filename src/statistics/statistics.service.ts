import { Injectable } from "@nestjs/common";
import { CreateStatisticDto } from "./dto/create-statistic.dto";
import { UpdateStatisticDto } from "./dto/update-statistic.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { GameStatistics } from "./entity/game-statistics.entity";
import { Repository } from "typeorm";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { TStatisticsCounterAction } from "./statistics.types";

@Injectable()
export class StatisticsService {
    constructor(
        @InjectRepository(ReviewStatistics)
        private reviewStatisticsRepository: Repository<ReviewStatistics>,
    ) {}
}
