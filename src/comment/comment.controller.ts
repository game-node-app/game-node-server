import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommentService } from "./comment.service";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";

@Controller("comment")
@ApiTags("comment")
@UseGuards(AuthGuard)
export class CommentController {
    constructor(private readonly commentService: CommentService) {}

    @Post()
    async create(
        @Session() session: SessionContainer,
        @Body() dto: CreateCommentDto,
    ) {
        return this.commentService.create(session.getUserId(), dto);
    }
}
