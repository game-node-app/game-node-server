import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { JournalService } from "./journal.service";
import { ApiTags } from "@nestjs/swagger";
import { JournalPlayLogService } from "./journal-play-log.service";
import { JournalHeatmapService } from "./journal-heatmap.service";
import { JournalAchievementsService } from "./journal-achievements.service";
import { GetObtainedAchievementsJournalRequestDto } from "./dto/get-obtained-achievements-journal.dto";

@Controller("journal")
@ApiTags("journal")
@UseGuards(AuthGuard)
export class JournalController {
    constructor(
        private readonly journalService: JournalService,
        private readonly journalPlaylogService: JournalPlayLogService,
        private readonly journalHeatmapService: JournalHeatmapService,
        private readonly journalAchievementsService: JournalAchievementsService,
    ) {}

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
        return this.journalPlaylogService.getPlaylog(userId, gameId);
    }

    @Get("heatmap/:userId")
    @Public()
    public async getHeatmap(
        @Session() session: SessionContainer | undefined,
        @Param("userId") targetUserId: string,
    ) {
        return this.journalHeatmapService.buildHeatmap(
            session?.getUserId(),
            targetUserId,
        );
    }

    @Get("achievements/:userId")
    @Public()
    public async getObtainedAchievementsJournal(
        @Param("userId") userId: string,
    ) {
        return this.journalAchievementsService.buildObtainedAchievementsJournal(
            userId,
        );
    }
}
