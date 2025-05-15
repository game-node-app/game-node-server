import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { ExternalGameService } from "./external-game.service";
import { Roles } from "../../auth/roles.decorator";
import { EUserRoles } from "../../utils/constants";
import { SubmitExternalGameDto } from "./dto/submit-external-game.dto";

@Controller("/game/external")
@UseGuards(AuthGuard)
export class ExternalGameController {
    constructor(private readonly externalGameService: ExternalGameService) {}

    @Get("unmapped")
    @Roles([EUserRoles.MOD, EUserRoles.ADMIN])
    public async findUnmappedEntries() {
        return this.externalGameService.getUnmappedGames();
    }

    @Post("submit")
    public async submitExternalGame(@Body() dto: SubmitExternalGameDto) {
        return this.externalGameService.submit(dto);
    }
}
