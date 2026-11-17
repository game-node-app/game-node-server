import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
    UseGuards,
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
import { Session, SessionContainer } from "../auth/session.decorator";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { LibraryAccessService } from "../libraries/library-access.service";

@Controller("playtime")
@ApiTags("playtime")
@UseGuards(AuthGuard)
export class PlaytimeController {
    constructor(
        private readonly playtimeService: PlaytimeService,
        private readonly libraryAccessService: LibraryAccessService,
    ) {}

    @Get("user/:userId/:gameId/accumulated")
    @Public()
    async findAccumulatedForUserIdAndGameId(
        @Session() session: SessionContainer | undefined,
        @Param() dto: FindAllPlaytimeByGameIdRequestDto,
    ) {
        return this.playtimeService.findAccumulatedForUserIdAndGameId(
            dto.userId,
            dto.gameId,
            await this.libraryAccessService.resolve(
                session?.getUserId(),
                dto.userId,
            ),
        );
    }

    @Get("user/:userId/:gameId")
    @Public()
    async findAllByUserIdAndGameId(
        @Session() session: SessionContainer | undefined,
        @Param() dto: FindAllPlaytimeByGameIdRequestDto,
    ) {
        return this.playtimeService.findAllByUserIdAndGameId(
            dto.userId,
            dto.gameId,
            await this.libraryAccessService.resolve(
                session?.getUserId(),
                dto.userId,
            ),
        );
    }

    @Get("user/:userId")
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindAllPlaytimeResponseDto,
    })
    @Public()
    async findAllByUserId(
        @Session() session: SessionContainer | undefined,
        @Param() dto: FindAllPlaytimeRequestDto,
        @Query() options?: FindPlaytimeOptionsDto,
    ) {
        return this.playtimeService.findAllByUserId(
            dto.userId,
            options,
            await this.libraryAccessService.resolve(
                session?.getUserId(),
                dto.userId,
            ),
        );
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
    @Public()
    async findAllByUserIdWithFilters(
        @Session() session: SessionContainer | undefined,
        @Param("userId") userId: string,
        @Body() dto: FindAllPlaytimeFiltersDto,
    ) {
        return (await this.playtimeService.findAllByUserIdWithFilters(
            userId,
            dto,
            await this.libraryAccessService.resolve(
                session?.getUserId(),
                userId,
            ),
        )) as unknown as FindAllPlaytimeResponseDto;
    }
}
