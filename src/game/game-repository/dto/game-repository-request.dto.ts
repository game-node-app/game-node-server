import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";

export class GameRepositoryRequestDto extends BaseFindDto<Game> {}
