import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    Query,
    HttpException,
    UseInterceptors,
} from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
import { AuthGuard } from "../auth/auth.guard";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CreateCollectionEntryDto } from "./dto/create-collectionEntry.dto";
import { FindCollectionEntryDto } from "./dto/find-collection-entry.dto";
import { ApiBadRequestResponse } from "@nestjs/swagger";
import { CacheInterceptor } from "@nestjs/cache-manager";

@Controller("collections")
@UseGuards(new AuthGuard())
@UseInterceptors(CacheInterceptor)
export class CollectionsController {
    constructor(private readonly collectionsService: CollectionsService) {}

    @Get(":id")
    async findOneById(@Param("id") id: string) {
        return this.collectionsService.findOneById(id);
    }

    @Post()
    async create(
        @Session() session: SessionContainer,
        @Body() createCollectionDto: CreateCollectionDto,
    ) {
        await this.collectionsService.create(
            session.getUserId(),
            createCollectionDto,
        );
    }

    /**
     * Returns a specific collection entry based on ID or IGDB ID
     * It's redudant to return all the entries in the collection, since it's already
     * included in the /collections/:id endpoint.
     * @param collectionId
     * @param findEntryDto
     */
    @Get(":colId/entries")
    @ApiBadRequestResponse({ description: "Invalid query" })
    async getEntries(
        @Param("colId") collectionId: string,
        @Query() findEntryDto: FindCollectionEntryDto,
    ) {
        if (findEntryDto.entryId) {
            return this.collectionsService.findOneEntryById(
                findEntryDto.entryId,
            );
        } else if (findEntryDto.igdbId) {
            return this.collectionsService.findOneEntryByIgdbId(
                findEntryDto.igdbId,
            );
        } else {
            throw new HttpException(
                "Invalid query. Either entryId or igdbId must be provided.",
                400,
            );
        }
    }
    @Post(":colId/entries")
    async addEntry(
        @Param("colId") collectionId: string,
        @Body() createCollectionEntryDto: CreateCollectionEntryDto,
    ) {
        return this.collectionsService.createEntry(
            collectionId,
            createCollectionEntryDto,
        );
    }
}
