import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { IgdbSyncService } from "./igdb-sync.service";
import { CreateGameDto } from "./dto/create-game.dto";
import { JwtAuthGuard } from "../../auth/jwt-auth/jwt-auth.guard";
import { ApiTags } from "@nestjs/swagger";

@Controller("sync/igdb")
@ApiTags("sync-igdb")
@UseGuards(JwtAuthGuard)
export class IgdbSyncController {
    constructor(private readonly gameQueueService: IgdbSyncService) {}

    @Post()
    async sync(@Body() dto: CreateGameDto) {
        await this.gameQueueService.handle(dto.games);
    }
}
