import { BaseFindDto } from "../../../utils/base-find.dto";
import { GameExclusion } from "../entity/game-exclusion.entity";
import { OmitType } from "@nestjs/swagger";
import {
    PaginationInfo,
    PaginationResponseDto,
} from "../../../utils/pagination/pagination-response.dto";

export class FindAllExcludedGamesRequestDto extends OmitType(
    BaseFindDto<GameExclusion>,
    ["search"],
) {}

export class FindAllExcludedGamesResponseDto implements PaginationResponseDto {
    data: GameExclusion[];
    pagination: PaginationInfo;
}
