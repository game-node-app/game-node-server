import { Game } from "../entities/game.entity";
import { PaginationInfo } from "../../../utils/pagination/pagination-response.dto";

export class GameRepositoryPaginatedResponseDto {
    data: Game[];
    pagination: PaginationInfo;
}
