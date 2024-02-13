import {
    Controller,
    Post,
    Body,
    Param,
    UseGuards,
    Patch,
    Get,
    Delete,
    HttpStatus,
    HttpCode,
} from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { AuthGuard } from "../auth/auth.guard";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { UpdateCollectionDto } from "./dto/update-collection.dto";

@Controller("collections")
@ApiTags("collections")
@UseGuards(AuthGuard)
export class CollectionsController {
    constructor(private readonly collectionsService: CollectionsService) {}

    /**
     * Returns a collection which the user has access to
     *
     * (Either its own collection or a public one)
     * @param session
     * @param collectionId
     * @param dto
     */
    @Get(":id")
    @Public()
    async findOneByIdWithPermissions(
        @Session() session: SessionContainer,
        @Param("id") collectionId: string,
    ) {
        return this.collectionsService.findOneByIdWithPermissions(
            session?.getUserId(),
            collectionId,
        );
    }

    @Get("library/:userId")
    @Public()
    async findAllByUserIdWithPermissions(
        @Session() session: SessionContainer,
        @Param("userId") targetUserId: string,
    ) {
        const currentUserId = session?.getUserId();
        return await this.collectionsService.findAllByUserIdWithPermissions(
            currentUserId,
            targetUserId,
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

    @Patch(":id")
    async update(
        @Session() session: SessionContainer,
        @Param("id") collectionId: string,
        @Body() updateCollectionDto: UpdateCollectionDto,
    ) {
        return await this.collectionsService.update(
            session.getUserId(),
            collectionId,
            updateCollectionDto,
        );
    }

    @Delete(":id")
    @HttpCode(HttpStatus.NO_CONTENT)
    async delete(
        @Session() session: SessionContainer,
        @Param("id") collectionId: string,
    ) {
        return await this.collectionsService.delete(
            session.getUserId(),
            collectionId,
        );
    }
}
