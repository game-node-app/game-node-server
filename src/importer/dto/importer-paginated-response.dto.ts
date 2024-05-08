import { GameExternalGame } from "../../game/game-repository/entities/game-external-game.entity";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";

export class ImporterPaginatedResponseDto {
    data: GameExternalGame[];
    pagination: PaginationInfo;
}
