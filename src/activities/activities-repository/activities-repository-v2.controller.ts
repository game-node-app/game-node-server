import {
    Controller,
    Get,
    Query,
    UseGuards,
    UseInterceptors,
    Version,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { ActivitiesRepositoryService } from "./activities-repository.service";
import { ActivitiesPaginatedResponseDto } from "./dto/activities-paginated-response.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { Public } from "../../auth/public.decorator";
import { FindLatestActivitiesDto } from "./dto/find-latest-activities.dto";
import { Session, SessionContainer } from "../../auth/session.decorator";

@Controller({
    path: "activities",
    version: "2",
})
@ApiTags("activities")
@UseGuards(AuthGuard)
export class ActivitiesRepositoryV2Controller {
    constructor(
        private readonly activitiesRepositoryService: ActivitiesRepositoryService,
    ) {}

    @Get()
    @ApiOkResponse({
        type: ActivitiesPaginatedResponseDto,
    })
    @UseInterceptors(PaginationInterceptor)
    @Public()
    async findLatest(
        @Query() dto: FindLatestActivitiesDto,
        @Session() session: SessionContainer | undefined,
    ) {
        return this.activitiesRepositoryService.findLatest(
            dto,
            session?.getUserId(),
        );
    }
}
