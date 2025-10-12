import { Body, Controller, Patch, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../../auth/auth.guard";
import { CollectionsOrderingService } from "./collections-ordering.service";
import { Session } from "../../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CollectionEntryUpdateOrderingDto } from "../dto/collection-entry-update-ordering.dto";

@Controller("collections-entries/ordering")
@ApiTags("collections-entries-ordering")
@UseGuards(AuthGuard)
export class CollectionsOrderingController {
    constructor(
        private readonly collectionsOrderingService: CollectionsOrderingService,
    ) {}

    @Patch()
    async updateCollectionEntryOrdering(
        @Session() session: SessionContainer,
        @Body() dto: CollectionEntryUpdateOrderingDto,
    ) {
        return this.collectionsOrderingService.reOrderEntryInCollection(
            session.getUserId(),
            dto,
        );
    }
}
