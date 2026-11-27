import { BaseFindDto } from "../../../utils/base-find.dto";
import { PickType } from "@nestjs/swagger";
import { IsISO8601, IsNotEmpty, IsObject, IsOptional } from "class-validator";
import { FindOptionsRelations } from "typeorm";
import { Game } from "../entities/game.entity";
import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../../utils/pagination/pagination-response.dto";
import { IsBoundedRelations, ClampLimit, MAX_LARGE_PAGE_LIMIT } from "../../../utils/request-bounds";

export enum GameRepositoryCollectionType {
    UPCOMING = "upcoming",
    RECENTLY_RELEASED = "recently_released",
}

export class FindGamesByCollectionTypeRequestDto extends PickType(BaseFindDto, [
    "offset",
    "limit",
]) {
    @IsNotEmpty()
    collectionType: GameRepositoryCollectionType;
    // The release calendar, collection move form and admin achievement list load a whole set at once.
    @ClampLimit(MAX_LARGE_PAGE_LIMIT)
    limit?: number = 20;
    @IsOptional()
    @IsISO8601()
    from?: string;
    @IsOptional()
    @IsISO8601()
    to?: string;
    @IsOptional()
    @IsObject()
    @IsBoundedRelations()
    relations?: FindOptionsRelations<Game>;
}

export class FindGamesByCollectionTypeResponseDto
    implements PaginationResponseDto
{
    data: Game[];
    pagination: PaginationInfo;
}
