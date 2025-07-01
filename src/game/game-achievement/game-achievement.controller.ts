import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { GameAchievementService } from "./game-achievement.service";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";

@Controller("game/achievement")
@ApiTags("game-achievement")
@UseGuards(AuthGuard)
export class GameAchievementController {
    constructor(
        private readonly gameAchievementService: GameAchievementService,
    ) {}

    @Get(":externalGameId")
    @Public()
    public async findAllByExternalGameId(
        @Param("externalGameId") externalGameId: number,
    ) {
        return this.gameAchievementService.findAllByExternalGameId(
            externalGameId,
        );
    }

    @Get(":externalGameId/obtained")
    @Public()
    public async findAllObtainedByExternalGameId(
        @Session() session: SessionContainer | undefined,
        @Param("externalGameId") externalGameId: number,
    ) {
        return this.gameAchievementService.findAllObtainedByExternalGameId(
            session?.getUserId(),
            externalGameId,
        );
    }

    @Get(":externalGameId/:externalAchievementId")
    @Public()
    public async findOneByExternalGameId(
        @Param("externalGameId") externalGameId: number,
        @Param("externalAchievementId") externalAchievementId: string,
    ) {
        return this.gameAchievementService.findOneByExternalGameId(
            externalGameId,
            externalAchievementId,
        );
    }
}
