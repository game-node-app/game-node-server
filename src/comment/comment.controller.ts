import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CommentService } from "./comment.service";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { FindAllCommentsDto } from "./dto/find-all-comments.dto";
import { Public } from "../auth/public.decorator";
import { FindCommentsPaginatedResponseDto } from "./dto/find-comments-paginated-response.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";

@Controller("comment")
@ApiTags("comment")
@UseGuards(AuthGuard)
export class CommentController {
    constructor(private readonly commentService: CommentService) {}

    @Get()
    @Public()
    @ApiOkResponse({
        type: FindCommentsPaginatedResponseDto,
    })
    async findAll(@Query() dto: FindAllCommentsDto) {
        return this.commentService.findAll(dto);
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @Session() session: SessionContainer,
        @Body() dto: CreateCommentDto,
    ) {
        return this.commentService.create(session.getUserId(), dto);
    }

    @Patch(":id")
    @HttpCode(HttpStatus.NO_CONTENT)
    async update(
        @Session() session: SessionContainer,
        @Param("id") commentId: string,
        @Body() dto: UpdateCommentDto,
    ) {
        return this.commentService.update(session.getUserId(), commentId, dto);
    }
}
