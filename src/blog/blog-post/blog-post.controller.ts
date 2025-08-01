import {
    Body,
    Controller,
    Delete,
    FileTypeValidator,
    Get,
    HttpCode,
    HttpStatus,
    MaxFileSizeValidator,
    Param,
    ParseFilePipe,
    Post,
    Put,
    Query,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { Roles } from "../../auth/roles.decorator";
import { EUserRoles } from "../../utils/constants";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { FileInterceptor } from "@nestjs/platform-express";
import { CreateUpdateBlogPostDto } from "./dto/create-update-blog-post.dto";
import { BlogPostService } from "./blog-post.service";
import { ApiBody, ApiConsumes, ApiOkResponse } from "@nestjs/swagger";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import {
    FindAllBlogPostRequestDto,
    FindAllBlogPostResponseDto,
} from "./dto/find-blog-post.dto";
import { Public } from "../../auth/public.decorator";
import { UpdateBlogPostImageDto } from "./dto/update-blog-post-image.dto";

@Controller("blog/post")
@UseGuards(AuthGuard)
export class BlogPostController {
    constructor(private readonly blogPostService: BlogPostService) {}

    @Get("tags")
    @Public()
    public async findAllTags() {
        return this.blogPostService.findAllTags();
    }

    @Get(":postId")
    @Public()
    public async findOneById(
        @Session() session: SessionContainer | undefined,
        @Param("postId") postId: string,
    ) {
        return this.blogPostService.findOneOrFail(session?.getUserId(), postId);
    }

    @Get()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindAllBlogPostResponseDto,
    })
    @Public()
    public async findAll(
        @Session() session: SessionContainer | undefined,
        @Query() dto: FindAllBlogPostRequestDto,
    ) {
        return this.blogPostService.findAll(session?.getUserId(), dto);
    }

    @Post()
    @Roles([EUserRoles.ADMIN, EUserRoles.MOD, EUserRoles.EDITOR])
    @UseInterceptors(FileInterceptor("image"))
    @ApiConsumes("multipart/form-data")
    @HttpCode(HttpStatus.CREATED)
    public async create(
        @Session() session: SessionContainer,
        @UploadedFile(
            new ParseFilePipe({
                fileIsRequired: false,
                validators: [
                    new FileTypeValidator({
                        fileType: "image",
                    }),
                    new MaxFileSizeValidator({
                        maxSize: 10 * 1024 * 1000,
                    }),
                ],
            }),
        )
        image: Express.Multer.File | undefined,
        @Body() dto: CreateUpdateBlogPostDto,
    ) {
        await this.blogPostService.createOrUpdate(
            session.getUserId(),
            dto,
            image,
        );
    }

    @Put(":postId/image")
    @Roles([EUserRoles.ADMIN, EUserRoles.MOD, EUserRoles.EDITOR])
    @ApiConsumes("multipart/form-data")
    @UseInterceptors(FileInterceptor("image"))
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBody({
        type: UpdateBlogPostImageDto,
        required: true,
    })
    public async updatePostImage(
        @Session() session: SessionContainer,
        @Param("postId") postId: string,
        @UploadedFile(
            new ParseFilePipe({
                fileIsRequired: true,
                validators: [
                    new FileTypeValidator({
                        fileType: "image",
                    }),
                    new MaxFileSizeValidator({
                        maxSize: 10 * 1024 * 1000,
                    }),
                ],
            }),
        )
        image: Express.Multer.File,
    ) {
        await this.blogPostService.updatePostImage(
            session.getUserId(),
            postId,
            image,
        );
    }

    @Delete(":postId")
    @Roles([EUserRoles.ADMIN, EUserRoles.MOD, EUserRoles.EDITOR])
    @HttpCode(HttpStatus.NO_CONTENT)
    public async delete(@Param("postId") postId: string) {
        await this.blogPostService.delete(postId);
    }
}
