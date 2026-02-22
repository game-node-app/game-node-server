import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RecapService } from "./recap.service";

@Controller("recap")
@ApiTags("recap")
export class RecapController {
    constructor(private readonly recapService: RecapService) {}

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
