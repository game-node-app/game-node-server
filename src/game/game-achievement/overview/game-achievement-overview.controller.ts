import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../../auth/auth.guard";
import { Session } from "../../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";

@Controller("game/achievement/overview")
@ApiTags("game-achievement-overview")
@UseGuards(AuthGuard)
export class GameAchievementOverviewController {
    @Get(":userId")
    public async getOverviewByUserId(@Session() session: SessionContainer) {}
}
