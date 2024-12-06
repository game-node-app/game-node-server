import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { CommentService } from "./comment.service";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { FindAllCommentsDto } from "./dto/find-all-comments.dto";
import { Public } from "../auth/public.decorator";
import { FindCommentsPaginatedResponseDto } from "./dto/find-comments-paginated-response.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { CommentSourceType } from "./comment.constants";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { DeleteCommentDto } from "./dto/delete-comment.dto";
import { SuspensionGuard } from "../suspension/suspension.guard";
import { BaseFindDto } from "../utils/base-find.dto";
import { UserComment } from "./entity/user-comment.entity";
import { ReviewComment } from "./entity/review-comment.entity";
import { ActivityComment } from "./entity/activity-comment.entity";

@Controller("comment")
@ApiTags("comment")
@UseGuards(AuthGuard)
export class CommentController {
    constructor(private readonly commentService: CommentService) {}

    @Post()
    @Public()
    @ApiOkResponse({
        type: FindCommentsPaginatedResponseDto,
    })
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(PaginationInterceptor)
    async findAll(@Body() dto: FindAllCommentsDto) {
        const result = await this.commentService.findAll(dto);
        return result;
    }

    @Get(":sourceType/:id")
    @ApiOkResponse({
        schema: {
            oneOf: [
                { type: getSchemaPath(ReviewComment) },
                { type: getSchemaPath(ActivityComment) },
            ],
        },
    })
    @Public()
    async findOneById(
        @Param("sourceType") sourceType: CommentSourceType,
        @Param("id") commentId: string,
    ) {
        return this.commentService.findOneByIdOrFail(sourceType, commentId);
    }

    @Get(":sourceType/:id/children")
    @Public()
    async findAllChildrenById(
        @Param("sourceType") sourceType: CommentSourceType,
        @Param("id") commentId: string,
        @Query() dto: BaseFindDto<UserComment>,
    ) {
        return this.commentService.findAllChildrenById(
            sourceType,
            commentId,
            dto,
        );
    }

    @Post("create")
    @HttpCode(HttpStatus.CREATED)
    @UseGuards(SuspensionGuard)
    async create(
        @Session() session: SessionContainer,
        @Body() dto: CreateCommentDto,
    ) {
        return this.commentService.create(session.getUserId(), dto);
    }

    @Patch(":id")
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(SuspensionGuard)
    async update(
        @Session() session: SessionContainer,
        @Param("id") commentId: string,
        @Body() dto: UpdateCommentDto,
    ) {
        return this.commentService.update(session.getUserId(), commentId, dto);
    }

    @Delete(":id")
    async delete(
        @Session() session: SessionContainer,
        @Param("id") commentId: string,
        @Body() dto: DeleteCommentDto,
    ) {
        return this.commentService.delete(session.getUserId(), commentId, dto);
    }
}
