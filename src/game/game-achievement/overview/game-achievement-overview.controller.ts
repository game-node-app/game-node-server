import { Controller, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../../auth/auth.guard";

@Controller("game-achievement/overview")
@ApiTags("game-achievement-overview")
@UseGuards(AuthGuard)
export class GameAchievementOverviewController {}
