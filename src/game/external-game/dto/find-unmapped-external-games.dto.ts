import { PickType } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { PaginationResponseDto } from "../../../utils/pagination/pagination-response.dto";
import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";
import { UnmappedExternalGame } from "../entity/unmapped-external-game.entity";

export class FindUnmappedExternalGamesRequestDto extends PickType(
    BaseFindDto<UnmappedExternalGame>,
    ["limit", "offset"],
) {
    @IsOptional()
    @IsEnum(EGameExternalGameCategory)
    category?: EGameExternalGameCategory;
}

export class UnmappedExternalGameDto {
    id: number;
    sourceUid: string;
    category: EGameExternalGameCategory;
    name: string | null;
    ownerCount: number;
}

export class FindUnmappedExternalGamesResponseDto extends PaginationResponseDto {
    declare data: UnmappedExternalGameDto[];
}
