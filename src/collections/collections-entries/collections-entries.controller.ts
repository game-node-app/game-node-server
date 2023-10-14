import {
    Body,
    Controller,
    Get,
    HttpException,
    Param,
    Patch,
    Post,
} from "@nestjs/common";
import { CollectionsEntriesService } from "./collections-entries.service";
import { ApiBadRequestResponse, ApiTags } from "@nestjs/swagger";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CreateCollectionEntryDto } from "./dto/create-collectionEntry.dto";
import { UpdateCollectionEntryDto } from "./dto/update-collectionEntry.dto";

@Controller("collections/entries")
@ApiTags("collections")
export class CollectionsEntriesController {
    constructor(private collectionsEntriesService: CollectionsEntriesService) {}

    @Post()
    async create(@Body() createCollectionEntryDto: CreateCollectionEntryDto) {
        return await this.collectionsEntriesService.create(
            createCollectionEntryDto,
        );
    }

    @Patch(":igdbId")
    async update(
        @Session() session: SessionContainer,
        @Param("igdbId") igdbId: number,
        @Body() updateCollectionEntryDto: UpdateCollectionEntryDto,
    ) {
        if (igdbId == undefined) {
            throw new HttpException(
                "Invalid query. igdbId must be provided.",
                400,
            );
        }
        const userId = session.getUserId();
        return this.collectionsEntriesService.update(
            userId,
            igdbId,
            updateCollectionEntryDto,
        );
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
        return this.collectionsEntriesService.findOneByUserIdAndGameIdOrFail(
            userId,
            igdbId,
        );
    }
}
