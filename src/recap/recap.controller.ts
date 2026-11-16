import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Put,
    UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RecapService } from "./recap.service";
import { RecapWindowService } from "./recap-window.service";
import { RecapGoalsService } from "./recap-goals.service";
import { AuthGuard } from "../auth/auth.guard";
import { Session, SessionContainer } from "../auth/session.decorator";
import { UpdateRecapGoalDto } from "./dto/update-recap-goal.dto";

@Controller("recap")
@ApiTags("recap")
export class RecapController {
    constructor(
        private readonly recapService: RecapService,
        private readonly recapWindowService: RecapWindowService,
        private readonly recapGoalsService: RecapGoalsService,
    ) {}

    /**
     * Returns the current Recap year, its phase and its opening and closing dates.
     */
    @Get("current")
    public async getCurrentRecap() {
        return this.recapWindowService.getCurrentRecap();
    }

    /**
     * Reads the authenticated user's goal and progress for a year.
     * Declared before :year/:userId so "goals" is not read as a year.
     */
    @Get("goals/:year")
    @UseGuards(AuthGuard)
    public async getGoal(
        @Session() session: SessionContainer,
        @Param("year", ParseIntPipe) year: number,
    ) {
        return this.recapGoalsService.getGoal(session.getUserId(), year);
    }

    /**
     * Sets or replaces the authenticated user's finished-games target.
     */
    @Put("goals/:year")
    @UseGuards(AuthGuard)
    public async setGoal(
        @Session() session: SessionContainer,
        @Param("year", ParseIntPipe) year: number,
        @Body() dto: UpdateRecapGoalDto,
    ) {
        return this.recapGoalsService.setGoal(
            session.getUserId(),
            year,
            dto.target,
        );
    }

    /**
     * Given a userID, returns the recap status for the current year.
     * This includes whether the recap is created and if the user is eligible for the recap.
     * The eligibility is determined by the user's account creation date and the target year.
     *
     * @param userId
     * @param year
     */
    @Get(":year/:userId/status")
    public async getRecapStatus(
        @Param("userId") userId: string,
        @Param("year") year: number,
    ) {
        return this.recapService.getRecapStatus(userId, year);
    }

    /**
     * Given a year and userId, returns the actual recap data for that user in that year.
     * @param userId
     * @param year
     */
    @Get(":year/:userId")
    public async getRecapByYear(
        @Param("userId") userId: string,
        @Param("year") year: number,
    ) {
        return this.recapService.getRecapByUserId(userId, year);
    }
}
