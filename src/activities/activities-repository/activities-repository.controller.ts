import {
    Controller,
    Get,
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
    async findLatest(@Query() dto: FindLatestActivitiesDto) {
        return this.activitiesRepositoryService.findLatest(dto);
    }
}
