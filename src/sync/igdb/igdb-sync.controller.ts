import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { IgdbSyncService, NonParsedGame } from "./igdb-sync.service";
import { JwtAuthGuard } from "../../auth/jwt-auth/jwt-auth.guard";
import { HttpStatusCode } from "axios";
import { ApiTags } from "@nestjs/swagger";

@Controller("sync/igdb")
@ApiTags("sync-igdb")
@UseGuards(JwtAuthGuard)
export class IgdbSyncController {
    constructor(private readonly igdbSyncService: IgdbSyncService) {}

    @Post()
    @HttpCode(HttpStatusCode.NoContent)
    async registerUpdateJob(@Body() games: NonParsedGame[]) {
        await this.igdbSyncService.registerUpdateJob(games);
    }
}
