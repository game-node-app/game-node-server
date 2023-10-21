import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { GameQueueService } from "./game-queue.service";
import { CreateGameDto } from "./dto/create-game.dto";
import { JwtAuthGuard } from "../../auth/jwt-auth/jwt-auth.guard";
import { ApiTags } from "@nestjs/swagger";

@Controller("game/queue")
@ApiTags("game-queue")
export class GameQueueController {
    constructor(private readonly gameQueueService: GameQueueService) {}

    @UseGuards(JwtAuthGuard)
    @Post()
    async sync(@Body() dto: CreateGameDto) {
        await this.gameQueueService.handle(dto.games);
    }
}
