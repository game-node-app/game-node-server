import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpException,
    HttpStatus,
    Param,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { CollectionsEntriesService } from "./collections-entries.service";
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CreateCollectionEntryDto } from "./dto/create-collection-entry.dto";
import { AuthGuard } from "../../auth/auth.guard";
import { FindCollectionEntriesDto } from "./dto/find-collection-entries.dto";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { CreateFavoriteStatusCollectionEntryDto } from "./dto/create-favorite-status-collection-entry.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";

import { CollectionEntriesPaginatedResponseDto } from "./dto/collection-entries-paginated-response.dto";
import { Public } from "../../auth/public.decorator";

@Controller("collections-entries")
@ApiTags("collections-entries")
@UseGuards(AuthGuard)
export class CollectionsEntriesController {
    constructor(private collectionsEntriesService: CollectionsEntriesService) {}

    @Post()
    @HttpCode(201)
    async replace(
        @Session() session: SessionContainer,
        @Body() createCollectionEntryDto: CreateCollectionEntryDto,
    ) {
        return await this.collectionsEntriesService.replace(
            session.getUserId(),
            createCollectionEntryDto,
        );
    }

    /**
     * Returns a specific collection entry based on game ID
     * @param session
     * @param gameId
     * @param dto
     */
    @Get("/game/:id")
    @HttpCode(200)
    @ApiBadRequestResponse({ description: "Invalid query" })
    async findOwnEntryByGameId(
        @Session() session: SessionContainer,
        @Param("id") gameId: number,
    ): Promise<CollectionEntry> {
        if (gameId == undefined) {
            throw new HttpException(
                "Invalid query. igdbId must be provided.",
                400,
            );
        }
        const userId = session.getUserId();
        return this.collectionsEntriesService.findOneByUserIdAndGameIdOrFail(
            userId,
            gameId,
        );
    }

    @Delete(":id")
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteOwnEntry(
        @Session() session: SessionContainer,
        @Param("id") entryId: string,
    ) {
        const userId = session.getUserId();
        return await this.collectionsEntriesService.delete(userId, entryId);
    }

    @Post("/game/:id/favorite")
    @HttpCode(HttpStatus.NO_CONTENT)
    async changeFavoriteStatus(
        @Session() session: SessionContainer,
        @Param("id") gameId: number,
        @Body() dto: CreateFavoriteStatusCollectionEntryDto,
    ) {
        const userId = session.getUserId();
        return await this.collectionsEntriesService.changeFavoriteStatus(
            userId,
            gameId,
            dto.isFavorite,
        );
    }

    @Get("/library/:id")
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: CollectionEntriesPaginatedResponseDto,
    })
    @Public()
    async findAllByLibraryId(
        @Session() session: SessionContainer | undefined,
        @Param("id") libraryId: string,
        @Query() dto: FindCollectionEntriesDto,
    ) {
        return this.collectionsEntriesService.findAllByUserIdWithPermissions(
            session?.getUserId(),
            libraryId,
            dto,
        );
    }

    @Get("/library/:id/favorites")
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: CollectionEntriesPaginatedResponseDto,
    })
    @Public()
    async findFavoritesByLibraryId(
        @Session() session: SessionContainer | undefined,
        @Param("id") libraryId: string,
        @Query() dto: FindCollectionEntriesDto,
    ) {
        return await this.collectionsEntriesService.findFavoritesByUserId(
            session?.getUserId(),
            libraryId,
            dto,
        );
    }

    @Get("/collection/:id")
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: CollectionEntriesPaginatedResponseDto,
    })
    @Public()
    async findAllByCollectionId(
        @Session() session: SessionContainer,
        @Param("id") collectionId: string,
        @Query() dto?: FindCollectionEntriesDto,
    ): Promise<CollectionEntriesPaginatedResponseDto> {
        return (await this.collectionsEntriesService.findAllByCollectionId(
            session?.getUserId(),
            collectionId,
            dto,
        )) as unknown as CollectionEntriesPaginatedResponseDto;
    }
}
