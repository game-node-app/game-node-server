import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AwardsVoteService } from "./awards-vote.service";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../../auth/auth.guard";
import { RegisterAwardsVoteDto } from "../dto/register-awards-vote.dto";
import { Public } from "../../auth/public.decorator";

@Controller("awards/vote")
@ApiTags("awards")
@UseGuards(AuthGuard)
export class AwardsVoteController {
    constructor(private readonly awardsVoteService: AwardsVoteService) {}

    @Get(":eventId/recent")
    @Public()
    public async getRecentVotesByEventId(@Param("eventId") eventId: number) {
        return this.awardsVoteService.getRecentVotesByEventId(eventId);
    }

    @Get(":userId/:categoryId")
    @Public()
    public async getVoteByUserId(
        @Param("userId") userId: string,
        @Param("categoryId") categoryId: number,
    ) {
        return this.awardsVoteService.getVoteByUserId(userId, categoryId);
    }

    @Post()
    public async registerVote(
        @Session() session: SessionContainer,
        @Body() dto: RegisterAwardsVoteDto,
    ) {
        await this.awardsVoteService.registerVote(session.getUserId(), dto);
    }
}
