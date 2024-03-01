import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
    Delete,
} from "@nestjs/common";
import { CreateReviewDto } from "./dto/create-review.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { ReviewsService } from "./reviews.service";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { FindReviewPaginatedDto } from "./dto/find-review-paginated.dto";
import { Review } from "./entities/review.entity";
import { FindReviewDto } from "./dto/find-review.dto";
import { Public } from "../auth/public.decorator";
import { ReviewScoreRequestDto } from "./dto/review-score-request.dto";

@Controller("reviews")
@ApiTags("reviews")
@UseGuards(AuthGuard)
export class ReviewsController {
    constructor(private readonly reviewsService: ReviewsService) {}

    @Post()
    createOrUpdate(
        @Session() session: SessionContainer,
        @Body() createReviewDto: CreateReviewDto,
    ) {
        return this.reviewsService.createOrUpdate(
            session.getUserId(),
            createReviewDto,
        );
    }

    @Get("/score")
    async getScoreForGameId(@Query() dto: ReviewScoreRequestDto) {
        return this.reviewsService.getScore(dto.gameId);
    }

    @Get("profile/:userId")
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindReviewPaginatedDto,
        status: 200,
    })
    @Public()
    async findAllByUserId(
        @Param("userId") userId: string,
        @Query() dto?: FindReviewDto,
    ) {
        return await this.reviewsService.findAllByUserId(userId, dto);
    }

    @Get("game/:id")
    @UseInterceptors(PaginationInterceptor)
    @Public()
    @ApiOkResponse({
        type: FindReviewPaginatedDto,
        status: 200,
    })
    async findAllByGameId(
        @Param("id") gameId: number,
        @Query() dto?: FindReviewDto,
    ) {
        return this.reviewsService.findAllByGameId(gameId, dto);
    }

    @Get()
    @Public()
    @ApiOkResponse({
        type: Review,
        status: 200,
    })
    async findOneByUserIdAndGameId(
        @Query("id") userId: string,
        @Query("gameId") gameId: number,
    ) {
        return await this.reviewsService.findOneByUserIdAndGameId(
            userId,
            gameId,
        );
    }

    @Get(":id")
    @Public()
    async findOneById(@Param("id") id: string) {
        return this.reviewsService.findOneByIdOrFail(id);
    }

    @Delete(":id")
    async delete(
        @Session() session: SessionContainer,
        @Param("id") reviewId: string,
    ) {
        return await this.reviewsService.delete(session.getUserId(), reviewId);
    }
}
