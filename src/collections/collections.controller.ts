import {
    Controller,
    Post,
    Body,
    Param,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { AuthGuard } from "../auth/auth.guard";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { ApiTags } from "@nestjs/swagger";
import { CacheInterceptor } from "@nestjs/cache-manager";
import { Public } from "../auth/public.decorator";

@Controller("collections")
@ApiTags("collections")
@UseGuards(AuthGuard)
@UseInterceptors(CacheInterceptor)
export class CollectionsController {
    constructor(private readonly collectionsService: CollectionsService) {}

    /**
     * Returns a collection which the user has access to
     *
     * (Either its own collection or a public one)
     * @param session
     * @param collectionId
     */
    @Post(":id")
    @Public()
    async findOneByIdWithPermissions(
        @Session() session: SessionContainer,
        @Param("id") collectionId: string,
    ) {
        console.log("findOneByIdWithPermissions");
        console.log(session.getUserId());
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
