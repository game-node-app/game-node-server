import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    Req,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ReportService } from "./report.service";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { CreateReportRequestDto } from "./dto/create-report-request.dto";
import { Roles } from "../auth/roles.decorator";
import { EUserRoles } from "../utils/constants";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { PaginatedReportResponseDto } from "./dto/paginated-report-response.dto";
import { FindLatestReportRequestDto } from "./dto/find-report-request.dto";
import { HandleReportRequestDto } from "./dto/handle-report-request.dto";

@Controller("report")
@ApiTags("report")
@UseGuards(AuthGuard)
@Roles([EUserRoles.MOD, EUserRoles.ADMIN])
export class ReportController {
    constructor(private readonly reportService: ReportService) {}

    @Get()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: PaginatedReportResponseDto,
    })
    async findAllByLatest(@Query() dto: FindLatestReportRequestDto) {
        return this.reportService.findAllByLatest(dto);
    }

    @Get(":id")
    async findOneById(@Param("id") reportId: number) {
        return this.reportService.findOneByIdOrFail(reportId);
    }

    @Post()
    @Roles([EUserRoles.USER])
    async create(
        @Session() session: SessionContainer,
        @Body() dto: CreateReportRequestDto,
    ) {
        await this.reportService.create(session.getUserId(), dto);
    }

    @Post(":id/handle")
    async handle(
        @Session() session: SessionContainer,
        @Param("id") reportId: number,
        @Body() dto: HandleReportRequestDto,
    ) {
        await this.reportService.handle(session.getUserId(), reportId, dto);
    }
}
