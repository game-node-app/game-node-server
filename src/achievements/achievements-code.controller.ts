import { Controller, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AchievementsCodeService } from "./achievements-code.service";
import { AuthGuard } from "../auth/auth.guard";

@Controller("achievements/code")
@ApiTags("achievements-code")
@UseGuards(AuthGuard)
export class AchievementsCodeController {
    constructor(
        private readonly achievementsCodeService: AchievementsCodeService,
    ) {}

    @
}
