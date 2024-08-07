import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { RecommendationService } from "./recommendation.service";
import { Session } from "src/auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { GetRecommendationsRequestDto } from "./dto/get-recommendations.dto";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "src/auth/auth.guard";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { hours, ThrottlerGuard } from "@nestjs/throttler";

@Controller("recommendation")
@ApiTags("recommendation")
@UseGuards(AuthGuard)
// @UseInterceptors(CacheInterceptor)
@UseGuards(ThrottlerGuard)
export class RecommendationController {
    constructor(
        private readonly recommendationService: RecommendationService,
    ) {}

    @Get()
    // @CacheTTL(hours(6))
    async getRecommendations(
        @Session() session: SessionContainer,
        @Query() dto: GetRecommendationsRequestDto,
    ) {
        return this.recommendationService.getRecommendations(
            session.getUserId(),
            dto,
        );
    }
}
