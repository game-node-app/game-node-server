import { GameExternalGame } from "../../game/game-repository/entities/game-external-game.entity";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import { ImporterResponseItemDto } from "./importer-response-item.dto";

export class ImporterPaginatedResponseDto {
    data: ImporterResponseItemDto[];
    pagination: PaginationInfo;
}
