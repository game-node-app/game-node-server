import { Controller, Get, Param, Query } from "@nestjs/common";
import { TimeToBeatService } from "./time-to-beat.service";
import { ApiTags } from "@nestjs/swagger";
import { FindAllGameTimeToBeatRequestDto } from "../dto/find-all-game-playtime.dto";

@Controller("playtime/ttb")
@ApiTags("playtime-ttb")
export class TimeToBeatController {
    constructor(private readonly timeToBeatService: TimeToBeatService) {}

    /**
     * Returns time to beat information for one game, if available.
     * @param gameId
     */
    @Get(":gameId")
    public async findOneForGameId(@Param("gameId") gameId: number) {
        return this.timeToBeatService.findOneForGameId(gameId);
    }

    /**
     * Returns time to beat information for each gameId, if available.
     * @param dto
     */
    @Get()
    public async findAllForGameId(
        @Query() dto: FindAllGameTimeToBeatRequestDto,
    ) {
        return this.timeToBeatService.findAllForGameIds(dto.gameIds);
    }
}
