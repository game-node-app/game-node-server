import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PlaytimeService } from "./playtime.service";
import {
    FindAllPlaytimeByGameIdRequestDto,
    FindAllPlaytimeRequestDto,
    FindAllPlaytimeResponseDto,
    FindPlaytimeOptionsDto,
} from "./dto/find-all-playtime.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { FindAllPlaytimeFiltersDto } from "./dto/find-all-playtime-filters.dto";
import { HttpStatusCode } from "axios";
import { SubmitUserPlaytimeDto } from "./dto/create-user-playtime.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";

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

    @Post()
    @HttpCode(HttpStatusCode.Created)
    async submit(
        @Session() session: SessionContainer,
        @Body() dto: SubmitUserPlaytimeDto,
    ) {
        await this.playtimeService.submit(session.getUserId(), dto);
    }

    @Post("user/:userId")
    @UseInterceptors(PaginationInterceptor)
    @ApiResponse({
        type: FindAllPlaytimeResponseDto,
    })
    async findAllByUserIdWithFilters(
        @Param("userId") userId: string,
        @Body() dto: FindAllPlaytimeFiltersDto,
    ) {
        return (await this.playtimeService.findAllByUserIdWithFilters(
            userId,
            dto,
        )) as unknown as FindAllPlaytimeResponseDto;
    }
}
