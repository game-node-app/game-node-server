import {
    Body,
    Controller,
    FileTypeValidator,
    HttpCode,
    HttpStatus,
    MaxFileSizeValidator,
    ParseFilePipe,
    Post,
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
import { CreateBlogPostDto } from "./dto/create-blog-post.dto";
import { BlogPostService } from "./blog-post.service";
import { ApiConsumes } from "@nestjs/swagger";

@Controller("blog/post")
@UseGuards(AuthGuard)
export class BlogPostController {
    constructor(private readonly blogPostService: BlogPostService) {}

    @Post()
    @Roles([EUserRoles.ADMIN, EUserRoles.MOD])
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
                        maxSize: 5 * 1024 * 1000,
                    }),
                ],
            }),
        )
        image: Express.Multer.File | undefined,
        @Body() dto: CreateBlogPostDto,
    ) {
        await this.blogPostService.create(session.getUserId(), dto, image);
    }
}
