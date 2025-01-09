import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PlaytimeService } from "./playtime.service";

@Controller("playtime")
@ApiTags("playtime")
export class PlaytimeController {
    constructor(private readonly playtimeService: PlaytimeService) {}
}
