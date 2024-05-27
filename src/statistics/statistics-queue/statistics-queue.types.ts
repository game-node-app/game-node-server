import {
    StatisticsActionType,
    StatisticsSourceType,
} from "../statistics.constants";
import { StatisticsActionDto } from "./dto/statistics-action.dto";

export class StatisticsLikeAction extends StatisticsActionDto {
    userId: string;
    action: StatisticsActionType;
}

export class StatisticsViewAction extends StatisticsActionDto {
    userId?: string;
}

export class StatisticsCreateAction {
    sourceId: string | number;
    sourceType: StatisticsSourceType;
}
