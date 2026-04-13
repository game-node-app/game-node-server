import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { GameAchievementService } from "./game-achievement.service";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { GameObtainedAchievementService } from "./game-obtained-achievement.service";
import { GameAchievementStatusService } from "./game-achievement-status.service";
import { FindGameCompletionStatusDto } from "./dto/game-completion-status.dto";

@Controller("game/achievement")
@ApiTags("game-achievement")
@UseGuards(AuthGuard)
export class GameAchievementController {
    constructor(
        private readonly gameAchievementService: GameAchievementService,
        private readonly gameAchievementObtainedService: GameObtainedAchievementService,
        private readonly gameAchievementStatusService: GameAchievementStatusService,
    ) {}

    @Get("status/:userId/:externalGameId")
    @Public()
    public async findStatusByExternalGameId(
        @Param("userId") userId: string,
        @Param("externalGameId") externalGameId: number,
    ) {
        return this.gameAchievementStatusService.findStatusByUserIdOrFail(
            userId,
            externalGameId,
        );
    }

    @Get("status/:userId")
    @Public()
    public async findAllStatusByUserId(
        @Param("userId") userId: string,
        @Query() dto: FindGameCompletionStatusDto,
    ) {
        return this.gameAchievementStatusService.findAllStatusByUserId(
            userId,
            dto,
        );
    }

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
        return this.gameAchievementObtainedService.findAllObtainedByExternalGameId(
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
