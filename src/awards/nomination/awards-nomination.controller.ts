import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Session, SessionContainer } from "../../auth/session.decorator";
import { UpdateNominationsDto } from "../dto/update-nominations.dto";
import { AwardsNominationService } from "./awards-nomination.service";

@Controller("awards")
@ApiTags("awards")
@UseGuards(AuthGuard)
export class AwardsNominationController {
    constructor(
        private readonly awardsNominationService: AwardsNominationService,
    ) {}

    @Get(":eventId/nominations/me")
    public async getMyNominations(
        @Session() session: SessionContainer,
        @Param("eventId") eventId: number,
    ) {
        return this.awardsNominationService.getMyNominations(
            session.getUserId(),
            eventId,
        );
    }

    @Put(":eventId/nominations/:categoryId")
    public async replaceNominations(
        @Session() session: SessionContainer,
        @Param("eventId") eventId: number,
        @Param("categoryId") categoryId: number,
        @Body() dto: UpdateNominationsDto,
    ) {
        await this.awardsNominationService.replaceNominations(
            session.getUserId(),
            eventId,
            categoryId,
            dto.gameIds,
        );
    }
}
