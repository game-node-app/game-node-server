import {
    StatisticsActionType,
    StatisticsSourceType,
} from "../statistics.constants";
import { StatisticsActionDto } from "./dto/statistics-action.dto";
import { IsEnum, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

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
