import { OmitType } from "@nestjs/swagger";
import { YearRecapPlayedGame } from "../entity/year-recap-played-game.entity";
import { GamePlatformDto } from "../../game/game-repository/dto/game-platform.dto";

export class YearRecapPlayedGameDto extends OmitType(YearRecapPlayedGame, [
    "platform",
]) {
    platform: GamePlatformDto;
}
