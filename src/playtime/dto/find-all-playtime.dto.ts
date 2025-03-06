import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../utils/pagination/pagination-response.dto";
import { UserPlaytimeDto } from "./user-playtime.dto";
import { IsBoolean, IsBooleanString, IsOptional } from "class-validator";

export class FindAllPlaytimeRequestDto {
    userId: string;
}

export class FindAllPlaytimeByGameIdRequestDto extends FindAllPlaytimeRequestDto {
    gameId: number;
}

export class FindPlaytimeOptionsDto extends PickType(BaseFindDto, [
    "offset",
    "limit",
    "orderBy",
]) {
    /**
     * If only entries from the last 3 months should be returned.
     */
    @IsOptional()
    @IsBoolean()
    onlyLatest? = true;
}

export class FindAllPlaytimeResponseDto implements PaginationResponseDto {
    data: UserPlaytimeDto[];
    pagination: PaginationInfo;
}
