import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Put,
    UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { Session, SessionContainer } from "../../auth/session.decorator";
import { GameCoverService } from "./game-cover.service";
import { GameCoverOptionResponseDto } from "./dto/game-cover-option-response.dto";
import {
    GameCoverChoiceResponseDto,
    SetGameCoverChoiceDto,
} from "./dto/game-cover-choice.dto";

@Controller("game/cover")
@ApiTags("game-cover")
@UseGuards(AuthGuard)
export class GameCoverController {
    constructor(private readonly gameCoverService: GameCoverService) {}

    @Get(":gameId/options")
    @Public()
    @ApiOkResponse({ type: GameCoverOptionResponseDto, isArray: true })
    async findOptions(@Param("gameId", ParseIntPipe) gameId: number) {
        return await this.gameCoverService.findOptions(gameId);
    }

    @Get(":gameId/mine")
    @ApiOkResponse({ type: GameCoverChoiceResponseDto })
    async findMine(
        @Session() session: SessionContainer,
        @Param("gameId", ParseIntPipe) gameId: number,
    ) {
        return await this.gameCoverService.findChoice(
            session.getUserId(),
            gameId,
        );
    }

    @Put(":gameId/mine")
    @ApiOkResponse({ type: GameCoverChoiceResponseDto })
    async setMine(
        @Session() session: SessionContainer,
        @Param("gameId", ParseIntPipe) gameId: number,
        @Body() dto: SetGameCoverChoiceDto,
    ) {
        return await this.gameCoverService.setChoice(
            session.getUserId(),
            gameId,
            dto.coverOptionId,
        );
    }

    @Delete(":gameId/mine")
    async removeMine(
        @Session() session: SessionContainer,
        @Param("gameId", ParseIntPipe) gameId: number,
    ) {
        await this.gameCoverService.removeChoice(session.getUserId(), gameId);
    }
}
