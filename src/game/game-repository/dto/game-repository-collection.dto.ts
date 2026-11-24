import { BaseFindDto } from "../../../utils/base-find.dto";
import { PickType } from "@nestjs/swagger";
import { IsISO8601, IsNotEmpty, IsObject, IsOptional } from "class-validator";
import { FindOptionsRelations } from "typeorm";
import { Game } from "../entities/game.entity";
import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../../utils/pagination/pagination-response.dto";

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
    @IsOptional()
    @IsISO8601()
    from?: string;
    @IsOptional()
    @IsISO8601()
    to?: string;
    @IsOptional()
    @IsObject()
    relations?: FindOptionsRelations<Game>;
}

export class FindGamesByCollectionTypeResponseDto
    implements PaginationResponseDto
{
    data: Game[];
    pagination: PaginationInfo;
}
