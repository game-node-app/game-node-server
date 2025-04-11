import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { Roles } from "../../auth/roles.decorator";
import { EUserRoles } from "../../utils/constants";
import { FileInterceptor } from "@nestjs/platform-express";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { CreateUpdateBlogPostV2Dto } from "./dto/create-update-blog-post.dto";
import { BlogPostService } from "./blog-post.service";

@Controller({
    path: "blog/post",
    version: "2",
})
@UseGuards(AuthGuard)
export class BlogPostV2Controller {
    constructor(private readonly blogPostService: BlogPostService) {}

    @Post()
    @Roles([EUserRoles.ADMIN, EUserRoles.MOD, EUserRoles.EDITOR])
    @UseInterceptors(FileInterceptor("image"))
    @HttpCode(HttpStatus.CREATED)
    async createOrUpdate(
        @Session() session: SessionContainer,
        @Body() dto: CreateUpdateBlogPostV2Dto,
    ) {
        return await this.blogPostService.createOrUpdate(
            session.getUserId(),
            dto,
            undefined,
        );
    }
}
