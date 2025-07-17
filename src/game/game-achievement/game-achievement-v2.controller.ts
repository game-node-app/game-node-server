import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { GameAchievementService } from "./game-achievement.service";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";

@Controller({
    path: "game/achievement",
    version: "2",
})
@ApiTags("game-achievement")
@UseGuards(AuthGuard)
export class GameAchievementV2Controller {
    constructor(
        private readonly gameAchievementService: GameAchievementService,
    ) {}

    @Get(":gameId")
    @Public()
    public async findAllByGameId(@Param("gameId") gameId: number) {
        return this.gameAchievementService.findAllByGameId(gameId);
    }

    @Get(":gameId/obtained")
    @Public()
    public async findAllObtainedByGameId(
        @Session() session: SessionContainer | undefined,
        @Param("gameId") gameId: number,
    ) {
        return this.gameAchievementService.findAllObtainedByGameId(
            session?.getUserId(),
            gameId,
        );
    }

    @Get(":userId/:gameId/obtained")
    @Public()
    public async findAllObtainedByUserId(
        @Param("userId") userId: string,
        @Param("gameId") gameId: number,
    ) {
        return this.gameAchievementService.findAllObtainedByGameId(
            userId,
            gameId,
        );
    }
}
