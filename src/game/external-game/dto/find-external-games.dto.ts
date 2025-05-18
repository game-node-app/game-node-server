import { PaginationResponseDto } from "../../../utils/pagination/pagination-response.dto";
import { GameExternalGame } from "../entity/game-external-game.entity";
import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";

export class FindExternalGamesRequestDto extends PickType(
    BaseFindDto<GameExternalGame>,
    ["limit", "offset"],
) {}

export class FindExternalGamesResponseDto extends PaginationResponseDto {
    declare data: GameExternalGame[];
}
