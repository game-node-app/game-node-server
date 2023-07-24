import {
    Body,
    Controller,
    Get,
    HttpException,
    Param,
    Post,
} from "@nestjs/common";
import { CollectionsEntriesService } from "./collections-entries.service";
import { ApiBadRequestResponse } from "@nestjs/swagger";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CreateCollectionEntryDto } from "../dto/create-collectionEntry.dto";

@Controller("collections/entries")
export class CollectionsEntriesController {
    constructor(private collectionsEntriesService: CollectionsEntriesService) {}

    @Post()
    async addEntry(
        @Param("id") collectionId: string,
        @Body() createCollectionEntryDto: CreateCollectionEntryDto,
    ) {
        if (!collectionId) {
            throw new HttpException(
                "Invalid query. collectionId must be provided at the path level.",
                400,
            );
        }
        return this.collectionsEntriesService.create(createCollectionEntryDto);
    }

    /**
     * Returns a specific collection entry based on IGDB ID
     * @param collectionId
     * @param findEntryDto
     */
    @Get(":igdbId")
    @ApiBadRequestResponse({ description: "Invalid query" })
    async findEntryByIgdbIdOrId(
        @Session() session: SessionContainer,
        @Param("igdbId") igdbId: number,
    ) {
        if (igdbId == undefined) {
            throw new HttpException(
                "Invalid query. igdbId must be provided.",
                400,
            );
        }
        const userId = session.getUserId();
        return this.collectionsEntriesService.findOneByIgdbIdOrFail(
            userId,
            igdbId,
        );
    }
}
