import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Query,
    Res,
    UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiProduces, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { Session, SessionContainer } from "../auth/session.decorator";
import { DailyService } from "./daily.service";
import {
    DailyArchiveRequestDto,
    DailyImportResultsRequestDto,
    DailyPlayRequestDto,
    DailyResultsRequestDto,
} from "./dto/daily-request.dto";
import {
    DailyArchiveResponseDto,
    DailyImportResultsResponseDto,
    DailyPlayResponseDto,
    DailyResultsResponseDto,
    DailyTodayResponseDto,
} from "./dto/daily-response.dto";

@Controller("daily")
@ApiTags("daily")
@UseGuards(AuthGuard)
export class DailyController {
    constructor(private readonly dailyService: DailyService) {}

    @Get()
    @Public()
    async findToday(
        @Session() session?: SessionContainer,
    ): Promise<DailyTodayResponseDto> {
        return this.dailyService.findToday(session?.getUserId());
    }

    @Get("archive")
    @Public()
    async findArchive(
        @Query() dto: DailyArchiveRequestDto,
        @Session() session?: SessionContainer,
    ): Promise<DailyArchiveResponseDto> {
        return this.dailyService.findArchive(session?.getUserId(), dto);
    }

    /**
     * Evaluates a whole play. Signed-in progress is saved and can only grow; guests are evaluated without saving.
     */
    @Post("puzzles/:id/play")
    @Public()
    async play(
        @Param("id", ParseIntPipe) id: number,
        @Body() dto: DailyPlayRequestDto,
        @Session() session?: SessionContainer,
    ): Promise<DailyPlayResponseDto> {
        return this.dailyService.play(session?.getUserId(), id, dto);
    }

    @Get("results")
    async findResults(
        @Session() session: SessionContainer,
        @Query() dto: DailyResultsRequestDto,
    ): Promise<DailyResultsResponseDto> {
        return this.dailyService.findResults(session.getUserId(), dto.mode);
    }

    /**
     * Imports finished guest plays into the signed-in account.
     */
    @Post("results/import")
    async importResults(
        @Session() session: SessionContainer,
        @Body() dto: DailyImportResultsRequestDto,
    ): Promise<DailyImportResultsResponseDto> {
        return this.dailyService.importResults(session.getUserId(), dto);
    }

    @Get("images/:token")
    @Public()
    @ApiProduces("image/webp")
    @ApiOkResponse({ schema: { type: "string", format: "binary" } })
    async getImage(
        @Param("token") token: string,
        @Res() response: Response,
    ): Promise<void> {
        const image = await this.dailyService.getImage(token);
        response
            .set({
                "Content-Type": "image/webp",
                "Cache-Control": "public, max-age=86400, immutable",
            })
            .send(image);
    }
}
