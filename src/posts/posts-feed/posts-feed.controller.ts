import {
    Body,
    Controller,
    Get,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { PostsFeedService } from "./posts-feed.service";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { GetPostsFeedDto } from "./dto/get-posts-feed.dto";
import { GetPostsPaginatedReponseDto } from "../dto/get-posts.dto";
import { CursorPaginationInterceptor } from "../../interceptor/cursor-pagination.interceptor";

@Controller("posts/feed")
@ApiTags("posts-feed")
@UseGuards(AuthGuard)
export class PostsFeedController {
    constructor(private readonly postsFeedService: PostsFeedService) {}

    @Get()
    @UseInterceptors(CursorPaginationInterceptor)
    @ApiOkResponse({
        type: GetPostsPaginatedReponseDto,
    })
    @Public()
    async buildFeed(
        @Query() dto: GetPostsFeedDto,
        @Session() session: SessionContainer | undefined,
    ) {
        return this.postsFeedService.buildFeed(session?.getUserId(), dto);
    }
}
