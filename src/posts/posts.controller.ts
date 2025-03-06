import {
    Body,
    Controller,
    Delete,
    FileTypeValidator,
    Get,
    HttpCode,
    Param,
    ParseFilePipe,
    Post,
    Query,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiConsumes, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { PostsService } from "./posts.service";
import { UploadPostImageRequestDto } from "./dto/upload-post-image.dto";
import { CreatePostDto } from "./dto/create-post.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { HttpStatusCode } from "axios";
import {
    GetPostsPaginatedReponseDto,
    GetPostsRequestDto,
} from "./dto/get-posts.dto";
import { CursorPaginationInterceptor } from "../interceptor/cursor-pagination.interceptor";

@Controller("posts/repository")
@ApiTags("posts")
@UseGuards(AuthGuard)
export class PostsController {
    constructor(private readonly postsService: PostsService) {}

    @Get()
    @UseInterceptors(CursorPaginationInterceptor)
    @ApiOkResponse({
        type: GetPostsPaginatedReponseDto,
    })
    async findAllWithPagination(@Query() dto: GetPostsRequestDto) {
        return this.postsService.findAllPaginated(dto);
    }

    @Get(":postId")
    async findOne(@Param("postId") postId: string) {
        return this.postsService.findOneByIdOrFail(postId);
    }

    @Post()
    async create(
        @Session() session: SessionContainer,
        @Body() dto: CreatePostDto,
    ) {
        return await this.postsService.create(session.getUserId(), dto);
    }

    @Post("image")
    @ApiConsumes("multipart/form-data")
    @UseInterceptors(FileInterceptor("file"))
    async uploadPostImage(
        @Session() session: SessionContainer,
        @Body() dto: UploadPostImageRequestDto,
        @UploadedFile(
            new ParseFilePipe({
                fileIsRequired: true,
                validators: [
                    new FileTypeValidator({
                        fileType: "image",
                    }),
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        return await this.postsService.uploadPostImage(
            session.getUserId(),
            file,
        );
    }

    @Delete(":postId")
    @HttpCode(HttpStatusCode.NoContent)
    async delete(
        @Session() session: SessionContainer,
        @Param("postId") postId: string,
    ) {
        await this.postsService.delete(session.getUserId(), postId);
    }
}
