import {
    Body,
    Controller,
    Get,
    NotFoundException,
    Param,
    ParseEnumPipe,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import {
    ApiCreatedResponse,
    ApiOkResponse,
    ApiParam,
    ApiTags,
} from "@nestjs/swagger";
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
import { ImporterBatchStatusRequestDto } from "./dto/importer-batch-status-request.dto";
import { ImporterBatchImportRequestDto } from "./dto/importer-batch-import-request.dto";
import { ImporterBatchImportService } from "./importer-batch-import.service";
import { ImporterBatchImportResponseDto } from "./dto/importer-batch-import-response.dto";

@Controller("importer")
@ApiTags("importer")
@UseGuards(AuthGuard)
export class ImporterController {
    constructor(
        private importerService: ImporterService,
        private readonly batchImportService: ImporterBatchImportService,
    ) {}

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
        const userId = session.getUserId();
        const result = await this.importerService.findUnprocessedEntries(
            userId,
            source,
            dto,
        );
        if (result[1] === 0) {
            const total = dto.search
                ? (
                      await this.importerService.findUnprocessedEntries(
                          userId,
                          source,
                          {
                              offset: 0,
                              limit: 1,
                              excludeInLibrary: dto.excludeInLibrary,
                          },
                      )
                  )[1]
                : 0;
            if (total === 0)
                throw new NotFoundException("No unprocessed entries found");
        }
        return result as unknown as ImporterPaginatedResponseDto;
    }

    @Post("status")
    async changeStatus(
        @Session() session: SessionContainer,
        @Body() dto: ImporterStatusUpdateRequestDto,
    ) {
        return this.importerService.changeStatus(session.getUserId(), dto);
    }

    @Post("status/batch")
    async changeStatusBatch(
        @Session() session: SessionContainer,
        @Body() dto: ImporterBatchStatusRequestDto,
    ) {
        return this.importerService.changeStatusBatch(session.getUserId(), dto);
    }

    @Post(":source/import")
    @ApiCreatedResponse({ type: ImporterBatchImportResponseDto })
    @ApiParam({ name: "source", enum: EImporterSource })
    async importBatch(
        @Session() session: SessionContainer,
        @Param("source", new ParseEnumPipe(EImporterSource))
        source: EImporterSource,
        @Body() dto: ImporterBatchImportRequestDto,
    ) {
        return this.batchImportService.import(session.getUserId(), source, dto);
    }
}
