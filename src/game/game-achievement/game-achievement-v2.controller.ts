import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { GameAchievementService } from "./game-achievement.service";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { GameAchievementObtainedService } from "./game-achievement-obtained.service";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import {
    FindObtainedAchievementsResponseDto,
    FindObtainedGameAchievementsRequestDto,
} from "./dto/game-obtained-achievement.dto";
import { GameAchievementActivityService } from "./game-achievement-activity.service";

@Controller({
    path: "game/achievement",
    version: "2",
})
@ApiTags("game-achievement")
@UseGuards(AuthGuard)
export class GameAchievementV2Controller {
    constructor(
        private readonly gameAchievementService: GameAchievementService,
        private readonly gameAchievementObtainedService: GameAchievementObtainedService,
        private readonly gameAchievementActivityService: GameAchievementActivityService,
    ) {}

    @Get("activity/:id")
    @Public()
    public async findActivityById(@Param("id") id: number) {
        return this.gameAchievementActivityService.findOneByIdOrFail(id);
    }

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
        return this.gameAchievementObtainedService.findAllObtainedByGameId(
            session?.getUserId(),
            gameId,
        );
    }

    @Get(":userId/obtained/all")
    @Public()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindObtainedAchievementsResponseDto,
    })
    public async findAllObtainedByUserId(
        @Param("userId") userId: string,
        @Query() dto: FindObtainedGameAchievementsRequestDto,
    ) {
        return this.gameAchievementObtainedService.findAllObtainedByUserId(
            userId,
            dto,
        );
    }

    @Get(":userId/:gameId/obtained")
    @Public()
    public async findAllObtainedByUserIdAndGameId(
        @Param("userId") userId: string,
        @Param("gameId") gameId: number,
    ) {
        return this.gameAchievementObtainedService.findAllObtainedByGameId(
            userId,
            gameId,
        );
    }
}
