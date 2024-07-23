import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AchievementsCodeService } from "./achievements-code.service";
import { AuthGuard } from "../auth/auth.guard";
import { CreateAchievementCodeRequestDto } from "./dto/create-achievement-code.dto";
import { Roles } from "../auth/roles.decorator";
import { EUserRoles } from "../utils/constants";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../auth/session.decorator";

@Controller("achievements/code")
@ApiTags("achievements-code")
@UseGuards(AuthGuard)
export class AchievementsCodeController {
    constructor(
        private readonly achievementsCodeService: AchievementsCodeService,
    ) {}

    @Get("consume/:code")
    async consume(
        @Session() session: SessionContainer,
        @Param("code") code: string,
    ) {
        return this.achievementsCodeService.consume(session.getUserId(), code);
    }

    @Post("generate")
    @Roles([EUserRoles.ADMIN])
    async generate(@Body() dto: CreateAchievementCodeRequestDto) {
        return this.achievementsCodeService.create(dto);
    }
}
