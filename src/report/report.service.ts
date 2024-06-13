import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Report } from "./entity/report.entity";
import { Repository } from "typeorm";
import { CreateReportRequestDto } from "./dto/create-report-request.dto";
import { ReportSourceType } from "./report.constants";
import { FindLatestReportRequestDto } from "./dto/find-report-request.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";

@Injectable()
export class ReportService {
    private logger = new Logger(ReportService.name);

    constructor(
        @InjectRepository(Report)
        private readonly reportRepository: Repository<Report>,
    ) {}

    findOneById(reportId: number) {
        return this.reportRepository.findOne({
            where: {
                id: reportId,
            },
        });
    }

    async findOneByIdOrFail(reportId: number) {
        const report = await this.findOneById(reportId);
        if (!report) {
            throw new HttpException(
                "No report for given parameters found",
                HttpStatus.NOT_FOUND,
            );
        }
        return report;
    }

    async create(userId: string, dto: CreateReportRequestDto) {
        const { sourceType, sourceId } = dto;
        const createdReport = this.reportRepository.create({
            profileUserId: userId,
            sourceType: sourceType,
        });
        switch (dto.sourceType) {
            case ReportSourceType.REVIEW:
                createdReport.targetReviewId = sourceId;
                break;
            case ReportSourceType.PROFILE:
                createdReport.targetProfileUserId = sourceId;
                break;
        }

        try {
            await this.reportRepository.insert(createdReport);
        } catch (err: unknown) {
            this.logger.error(err);
            throw new HttpException(
                "Failed to create Report. Please check request parameters.",
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    async discard(userId: string, reportId: number) {
        await this.reportRepository.delete({
            id: reportId,
            targetProfileUserId: userId,
        });
    }

    async findAllByLatest(dto: FindLatestReportRequestDto) {
        const baseFindOptions = buildBaseFindOptions<Report>(dto);
        return this.reportRepository.findAndCount({
            ...baseFindOptions,
            order: {
                createdAt: "DESC",
            },
        });
    }
}
