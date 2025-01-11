import { Controller, Get, Param, Query, UseInterceptors } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { PlaytimeService } from "./playtime.service";
import {
    FindAllPlaytimeByGameIdRequestDto,
    FindAllPlaytimeRequestDto,
    FindAllPlaytimeResponseDto,
    FindPlaytimeOptionsDto,
} from "./dto/find-all-playtime.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";

@Controller("playtime")
@ApiTags("playtime")
export class PlaytimeController {
    constructor(private readonly playtimeService: PlaytimeService) {}

    @Get("user/:userId/:gameId/accumulated")
    async findAccumulatedForUserIdAndGameId(
        @Param() dto: FindAllPlaytimeByGameIdRequestDto,
    ) {
        return this.playtimeService.findAccumulatedForUserIdAndGameId(
            dto.userId,
            dto.gameId,
        );
    }

    @Get("user/:userId/:gameId")
    async findAllByUserIdAndGameId(
        @Param() dto: FindAllPlaytimeByGameIdRequestDto,
    ) {
        return this.playtimeService.findAllByUserIdAndGameId(
            dto.userId,
            dto.gameId,
        );
    }

    @Get("user/:userId")
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindAllPlaytimeResponseDto,
    })
    async findAllByUserId(
        @Param() dto: FindAllPlaytimeRequestDto,
        @Query() options?: FindPlaytimeOptionsDto,
    ) {
        return this.playtimeService.findAllByUserId(dto.userId, options);
    }
}
