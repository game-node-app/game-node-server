import { BaseFindDto } from "../../../utils/base-find.dto";
import { Game } from "../entities/game.entity";

export class GameRepositoryFindOneDto extends BaseFindDto<Game> {}
