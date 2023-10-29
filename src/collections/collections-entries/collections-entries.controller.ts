import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpException,
    HttpStatus,
    Param,
    Post,
    UseGuards,
} from "@nestjs/common";
import { CollectionsEntriesService } from "./collections-entries.service";
import { ApiBadRequestResponse, ApiTags } from "@nestjs/swagger";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CreateCollectionEntryDto } from "./dto/create-collection-entry.dto";
import { AuthGuard } from "../../auth/auth.guard";
import { GetCollectionEntryDto } from "./dto/get-collection-entry.dto";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { FavoriteStatusCollectionEntryDto } from "./dto/favorite-status-collection-entry.dto";

@Controller("collections-entries")
@ApiTags("collections-entries")
@UseGuards(AuthGuard)
export class CollectionsEntriesController {
    constructor(private collectionsEntriesService: CollectionsEntriesService) {}

    @Post()
    @HttpCode(201)
    async create(
        @Session() session: SessionContainer,
        @Body() createCollectionEntryDto: CreateCollectionEntryDto,
    ) {
        return await this.collectionsEntriesService.createOrUpdate(
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
    @Post("/game/:id")
    @HttpCode(200)
    @ApiBadRequestResponse({ description: "Invalid query" })
    async findOwnEntryByGameId(
        @Session() session: SessionContainer,
        @Param("id") gameId: number,
        @Body() dto?: GetCollectionEntryDto,
    ): Promise<CollectionEntry[]> {
        if (gameId == undefined) {
            throw new HttpException(
                "Invalid query. igdbId must be provided.",
                400,
            );
        }
        const userId = session.getUserId();
        return this.collectionsEntriesService.findAllByUserIdAndGameIdOrFail(
            userId,
            gameId,
            dto,
        );
    }

    @Delete("/game/:id")
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteOwnEntryByGameId(
        @Session() session: SessionContainer,
        @Param("id") gameId: number,
    ) {
        const userId = session.getUserId();
        return await this.collectionsEntriesService.deleteByUserIdAndGameId(
            userId,
            gameId,
        );
    }

    @Post("/game/:id/favorite")
    @HttpCode(HttpStatus.NO_CONTENT)
    async changeFavoriteStatus(
        @Session() session: SessionContainer,
        @Param("id") gameId: number,
        @Body() dto: FavoriteStatusCollectionEntryDto,
    ) {
        const userId = session.getUserId();
        return await this.collectionsEntriesService.changeFavoriteStatus(
            userId,
            gameId,
            dto.isFavorite,
        );
    }
}
