import {
    StatisticsSourceType,
} from "../statistics.constants";
import { StatisticsActionDto } from "./dto/statistics-action.dto";

export class StatisticsViewAction extends StatisticsActionDto {
    userId?: string;
}

export class StatisticsCreateAction {
    sourceId: string | number;
    sourceType: StatisticsSourceType;
}
