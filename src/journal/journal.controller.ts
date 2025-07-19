import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { JournalService } from "./journal.service";
import { ApiTags } from "@nestjs/swagger";

@Controller("journal")
@ApiTags("journal")
@UseGuards(AuthGuard)
export class JournalController {
    constructor(private readonly journalService: JournalService) {}

    @Get("overview/:userId")
    @Public()
    public async getJournalOverview(
        @Session() session: SessionContainer | undefined,
        @Param("userId") userId: string,
    ) {
        return this.journalService.getOverview(session?.getUserId(), userId);
    }

    @Get("playlog/:userId/:gameId")
    @Public()
    public async getJournalPlaylog(
        @Param("userId") userId: string,
        @Param("gameId") gameId: number,
    ) {
        return this.journalService.getPlaylog(userId, gameId);
    }
}
