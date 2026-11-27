import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { Session, SessionContainer } from "../auth/session.decorator";
import { JournalService } from "./journal.service";
import { ApiTags } from "@nestjs/swagger";
import { JournalPlayLogService } from "./journal-play-log.service";
import { JournalHeatmapService } from "./journal-heatmap.service";
import { JournalAchievementsService } from "./journal-achievements.service";
import { GetJournalOverviewQueryDto } from "./dto/get-journal-overview.dto";
import { seconds, Throttle } from "@nestjs/throttler";

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
        @Query() dto: GetJournalOverviewQueryDto,
    ) {
        return this.journalService.getOverview(
            session?.getUserId(),
            userId,
            dto?.year,
        );
    }

    @Get("playlog/:userId/:gameId")
    @Public()
    public async getJournalPlaylog(
        @Session() session: SessionContainer | undefined,
        @Param("userId") userId: string,
        @Param("gameId") gameId: number,
    ) {
        return this.journalPlaylogService.getPlaylog(
            userId,
            gameId,
            session?.getUserId(),
        );
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
    // A cold build is expensive, so one client can't walk through many profiles.
    @Throttle({ default: { limit: 10, ttl: seconds(60) } })
    public async getObtainedAchievementsJournal(
        @Param("userId") userId: string,
    ) {
        return this.journalAchievementsService.buildObtainedAchievementsJournal(
            userId,
        );
    }
}
