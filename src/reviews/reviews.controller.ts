import { Controller, Get, Post, Body, Param, Query } from "@nestjs/common";
import { CreateReviewDto } from "./dto/create-review.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { FindReviewDto } from "./dto/find-review.dto";
import { ReviewsService } from "./reviews.service";
import { ApiTags } from "@nestjs/swagger";

@Controller("reviews")
@ApiTags("reviews")
export class ReviewsController {
    constructor(private readonly reviewsService: ReviewsService) {}

    @Post()
    create(
        @Session() session: SessionContainer,
        @Body() createReviewDto: CreateReviewDto,
    ) {
        return this.reviewsService.create(session.getUserId(), createReviewDto);
    }

    @Get()
    async findAllByIgdbId(@Query() findQueryDto: FindReviewDto) {
        return this.reviewsService.findAllByGameId(findQueryDto.igdbId);
    }

    @Get(":id")
    async findOneById(@Param("id") id: string) {
        return this.reviewsService.findOneById(id);
    }
}
