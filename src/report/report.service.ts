import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Report } from "./entity/report.entity";
import { Repository } from "typeorm";
import { CreateReportRequestDto } from "./dto/create-report-request.dto";
import { ReportHandleAction, ReportSourceType } from "./report.constants";
import { FindLatestReportRequestDto } from "./dto/find-report-request.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { ReviewsService } from "../reviews/reviews.service";
import { SessionContainer } from "supertokens-node/recipe/session";
import { HandleReportRequestDto } from "./dto/handle-report-request.dto";
import { UserRoleClaim } from "supertokens-node/lib/build/recipe/userroles";
import { EUserRoles } from "../utils/constants";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";

@Injectable()
export class ReportService {
    private logger = new Logger(ReportService.name);

    constructor(
        @InjectRepository(Report)
        private readonly reportRepository: Repository<Report>,
        private readonly notificationsQueueService: NotificationsQueueService,
        private readonly reviewsService: ReviewsService,
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
                const review =
                    await this.reviewsService.findOneByIdOrFail(sourceId);
                createdReport.targetReviewId = review.id;
                createdReport.targetProfileUserId = review.profileUserId;
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

    async handle(
        session: SessionContainer,
        reportId: number,
        dto: HandleReportRequestDto,
    ) {
        const report = await this.findOneByIdOrFail(reportId);
        const { action, deleteReportedContent } = dto;
        switch (action) {
            case ReportHandleAction.ALERT:
                this.notificationsQueueService.registerNotification({
                    sourceId: report.id,
                    userId: undefined,
                    sourceType: ENotificationSourceType.REPORT,
                    category: ENotificationCategory.ALERT,
                    targetUserId: report.targetProfileUserId,
                });
                break;
            case ReportHandleAction.SUSPEND:
                break;
            case ReportHandleAction.BAN:
                break;
            case ReportHandleAction.DISCARD:
                break;
        }
    }

    async verifyBanPermission(session: SessionContainer) {
        const roles = await session.getClaimValue(UserRoleClaim);
        if (roles == undefined || !roles.includes(EUserRoles.ADMIN)) {
        }
    }
}
