import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { FindLatestActivitiesDto } from "./dto/find-latest-activities.dto";
import { ActivitiesRepositoryService } from "./activities-repository.service";
import { ActivitiesPaginatedResponseDto } from "./dto/activities-paginated-response.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { ActivityResponseDto } from "./dto/activity-response.dto";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { Session, SessionContainer } from "../../auth/session.decorator";

@Controller("activities")
@ApiTags("activities")
@UseGuards(AuthGuard)
export class ActivitiesRepositoryController {
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
        return this.activitiesRepositoryService.findLatestExcludingTypes(
            dto,
            [ActivityType.OBTAINED_GAME_ACHIEVEMENT],
            session?.getUserId(),
        );
    }

    @Get("detail/:id")
    @ApiOkResponse({
        type: ActivityResponseDto,
    })
    @Public()
    async findOneById(
        @Param("id") activityId: string,
        @Session() session: SessionContainer | undefined,
    ) {
        return this.activitiesRepositoryService.findOneByOrFail(
            {
                where: {
                    id: activityId,
                },
            },
            session?.getUserId(),
        );
    }
}
