import { Controller, Get, Param } from "@nestjs/common";
import { HltbSyncService } from "./hltb-sync.service";
import { ApiTags } from "@nestjs/swagger";

@Controller("sync/hltb")
@ApiTags("sync-hltb")
export class HltbController {
    constructor(private hltbService: HltbSyncService) {}

    @Get(":gameId")
    async findPlaytimeForGameId(@Param("gameId") gameId: number) {
        return await this.hltbService.findOneByGameIdOrFail(gameId);
    }
}
