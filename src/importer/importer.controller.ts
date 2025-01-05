import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { ImporterService } from "./importer.service";
import { ImporterStatusUpdateRequestDto } from "./dto/importer-status-update-request.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { EImporterSource } from "./importer.constants";
import { ImporterUnprocessedRequestDto } from "./dto/importer-unprocessed-request.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { ImporterPaginatedResponseDto } from "./dto/importer-paginated-response.dto";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { minutes } from "@nestjs/throttler";

@Controller("importer")
@ApiTags("importer")
@UseGuards(AuthGuard)
export class ImporterController {
    constructor(private importerService: ImporterService) {}

    @Get(":source")
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: ImporterPaginatedResponseDto,
    })
    async findUnprocessedEntries(
        @Session() session: SessionContainer,
        @Param("source") source: EImporterSource,
        @Query() dto: ImporterUnprocessedRequestDto,
    ) {
        return (await this.importerService.findUnprocessedEntries(
            session.getUserId(),
            source,
            dto,
        )) as unknown as ImporterPaginatedResponseDto;
    }

    @Post("status")
    async changeStatus(
        @Session() session: SessionContainer,
        @Body() dto: ImporterStatusUpdateRequestDto,
    ) {
        return this.importerService.changeStatus(session.getUserId(), dto);
    }
}
