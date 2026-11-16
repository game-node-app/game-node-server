import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { Session, SessionContainer } from "../../auth/session.decorator";
import { AwardsBallotService } from "./awards-ballot.service";

@Controller("awards")
@ApiTags("awards")
@UseGuards(AuthGuard)
export class AwardsBallotController {
    constructor(private readonly awardsBallotService: AwardsBallotService) {}

    @Get(":eventId/ballot")
    public async getBallot(
        @Session() session: SessionContainer,
        @Param("eventId") eventId: number,
    ) {
        return this.awardsBallotService.getBallot(session.getUserId(), eventId);
    }

    @Get(":eventId/votes/:userId")
    @Public()
    public async getVotesByUserId(
        @Param("eventId") eventId: number,
        @Param("userId") userId: string,
    ) {
        return this.awardsBallotService.getVotesByUserId(eventId, userId);
    }
}
