import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RecapService } from "./recap.service";

@Controller("recap")
@ApiTags("recap")
export class RecapController {
    constructor(private readonly recapService: RecapService) {}

    // @Get(":year/:userId")
    // async getRecapData(
    //     @Param("year") year: number,
    //     @Param("userId") userId: string,
    // ) {}
}
