import {
    Controller,
    Get,
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
import { CacheTTL } from "@nestjs/cache-manager";
import { hours, ThrottlerGuard } from "@nestjs/throttler";
import { SessionAwareCacheInterceptor } from "../interceptor/session-aware-cache/session-aware-cache.interceptor";

@Controller("recommendation")
@ApiTags("recommendation")
@UseGuards(AuthGuard)
@UseInterceptors(SessionAwareCacheInterceptor)
@UseGuards(ThrottlerGuard)
export class RecommendationController {
    constructor(
        private readonly recommendationService: RecommendationService,
    ) {}

    @Get()
    @CacheTTL(hours(24))
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
