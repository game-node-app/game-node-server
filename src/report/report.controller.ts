import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ReportService } from "./report.service";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { CreateReportRequestDto } from "./dto/create-report-request.dto";

@Controller("report")
@ApiTags("report")
@UseGuards(AuthGuard)
export class ReportController {
    constructor(private readonly reportService: ReportService) {}

    @Post()
    async create(
        @Session() session: SessionContainer,
        @Body() dto: CreateReportRequestDto,
    ) {
        await this.reportService.create(session.getUserId(), dto);
    }
}
