import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../utils/pagination/pagination-response.dto";
import { UserPlaytimeDto } from "./user-playtime.dto";

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
]) {}

export class FindAllPlaytimeResponseDto implements PaginationResponseDto {
    data: UserPlaytimeDto[];
    pagination: PaginationInfo;
}
