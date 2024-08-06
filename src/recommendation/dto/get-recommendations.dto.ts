import { IsEnum, IsNotEmpty } from "class-validator";
import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";

export enum RecommendationCriteria {
    /**
     * Use finished games as criteria
     */
    FINISHED = "finished",
    /**
     * Use most consumed genres as criteria
     */
    GENRE = "genre",
    /**
     * Use most consumed themes as criteria
     */
    THEME = "theme",
}

/**
 * TODO: investigate how to implement pagination for this (it's pretty random)
 */
export class GetRecommendationsRequestDto extends PickType(BaseFindDto<any>, [
    "limit",
]) {
    /**
     * Criteria to be used for deciding on what to recommend.
     * E.g. finished games, genre of played games, etc.
     */
    @IsNotEmpty()
    @IsEnum(RecommendationCriteria)
    criteria: RecommendationCriteria;
}

export class GetRecommendationsResponseDto {
    gameIds: number[];
    criteriaId?: number;
}
