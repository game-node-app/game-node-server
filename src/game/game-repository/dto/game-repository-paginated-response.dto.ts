import { Game } from "../entities/game.entity";
import { withPaginationResponse } from "../../../utils/pagination/buildPaginationResponse";

export class GameRepositoryPaginatedResponseDto extends withPaginationResponse(
    Game,
) {}
