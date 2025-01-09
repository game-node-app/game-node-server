import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../utils/pagination/pagination-response.dto";
import { UserPlaytime } from "../entity/user-playtime.entity";

export class FindAllPlaytimeRequestDto extends PickType(BaseFindDto, [
    "offset",
    "limit",
    "orderBy",
]) {
    userId: string;
}

export class FindAllPlaytimeResponseDto implements PaginationResponseDto {
    data: UserPlaytime[];
    pagination: PaginationInfo;
}
