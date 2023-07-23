import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
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
import { ApiBadRequestResponse } from "@nestjs/swagger";
import { CacheInterceptor } from "@nestjs/cache-manager";

@Controller("collections")
@UseGuards(new AuthGuard())
@UseInterceptors(CacheInterceptor)
export class CollectionsController {
    constructor(private readonly collectionsService: CollectionsService) {}

    @Get("favorites")
    async findFavoritesCollection(@Session() session: SessionContainer) {
        return this.collectionsService.findFavoritesCollection(
            session.getUserId(),
        );
    }

    /**
     * Returns a specific collection entry based on IGDB ID
     * @param collectionId
     * @param findEntryDto
     */
    @Get(":id/entry/:igdbId")
    @ApiBadRequestResponse({ description: "Invalid query" })
    async findEntryByIgdbIdOrId(
        @Param("id") collectionId: string,
        @Param("igdbId") igdbId: number,
    ) {
        if (igdbId == undefined) {
            throw new HttpException(
                "Invalid query. igdbId must be provided.",
                400,
            );
        }
        return this.collectionsService.findOneEntryByIgdbId(igdbId);
    }

    @Post(":id/entry")
    async addEntry(
        @Param("id") collectionId: string,
        @Body() createCollectionEntryDto: CreateCollectionEntryDto,
    ) {
        return this.collectionsService.createEntry(
            collectionId,
            createCollectionEntryDto,
        );
    }

    /**
     * Returns a collection which the user has access to
     *
     * (Either its own collection or a public one)
     * @param session
     * @param collectionId
     */
    @Get(":id")
    async findOneByIdWithPermissions(
        @Session() session: SessionContainer,
        @Param("id") collectionId: string,
    ) {
        return this.collectionsService.findOneByIdWithPermissions(
            session.getUserId(),
            collectionId,
        );
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
}
