import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Report } from "./entity/report.entity";
import { FindOptionsWhere, Repository } from "typeorm";
import { CreateReportRequestDto } from "./dto/create-report-request.dto";
import { ReportHandleAction, ReportSourceType } from "./report.constants";
import { FindLatestReportRequestDto } from "./dto/find-report-request.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { ReviewsService } from "../reviews/reviews.service";
import { HandleReportRequestDto } from "./dto/handle-report-request.dto";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";
import { SuspensionService } from "../suspension/suspension.service";
import { CommentService } from "../comment/comment.service";
import { CommentSourceType } from "../comment/comment.constants";

@Injectable()
export class ReportService {
    private logger = new Logger(ReportService.name);

    constructor(
        @InjectRepository(Report)
        private readonly reportRepository: Repository<Report>,
        private readonly notificationsQueueService: NotificationsQueueService,
        private readonly reviewsService: ReviewsService,
        private readonly commentService: CommentService,
        private readonly suspensionService: SuspensionService,
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
            category: dto.category,
            reason: dto.reason,
        });

        switch (dto.sourceType) {
            case ReportSourceType.REVIEW: {
                const review =
                    await this.reviewsService.findOneByIdOrFail(sourceId);
                createdReport.targetReviewId = review.id;
                createdReport.targetProfileUserId = review.profileUserId;
                break;
            }
            case ReportSourceType.REVIEW_COMMENT: {
                const comment = await this.commentService.findOneByIdOrFail(
                    CommentSourceType.REVIEW,
                    sourceId,
                );
                createdReport.targetReviewCommentId = comment.id;
                createdReport.targetProfileUserId = comment.profileUserId;
                break;
            }
            case ReportSourceType.ACTIVITY_COMMENT: {
                const comment = await this.commentService.findOneByIdOrFail(
                    CommentSourceType.ACTIVITY,
                    sourceId,
                );
                createdReport.targetActivityCommentId = comment.id;
                createdReport.targetProfileUserId = comment.profileUserId;
                break;
            }

            case ReportSourceType.PROFILE: {
                createdReport.targetProfileUserId = sourceId;
                break;
            }
        }

        if (createdReport.targetProfileUserId === userId) {
            throw new HttpException(
                "User can't report its own content.",
                HttpStatus.BAD_REQUEST,
            );
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

    async findAllByLatest(dto: FindLatestReportRequestDto) {
        const baseFindOptions = buildBaseFindOptions<Report>(dto);
        const whereOptions: FindOptionsWhere<Report> = {};
        if (!dto.includeClosed) {
            whereOptions.isClosed = false;
        }
        return await this.reportRepository.findAndCount({
            ...baseFindOptions,
            where: whereOptions,
            order: {
                createdAt: "DESC",
            },
        });
    }

    async handle(
        handlerUserId: string,
        reportId: number,
        dto: HandleReportRequestDto,
    ) {
        const report = await this.findOneByIdOrFail(reportId);
        const { action, deleteReportedContent } = dto;

        if (report.isClosed) {
            throw new HttpException(
                "Report is already closed. No further action needed.",
                HttpStatus.BAD_REQUEST,
            );
        }

        switch (action) {
            case ReportHandleAction.SUSPEND:
                await this.suspensionService.create(
                    handlerUserId,
                    report.targetProfileUserId,
                    "suspension",
                );
                break;
            case ReportHandleAction.BAN:
                await this.suspensionService.create(
                    handlerUserId,
                    report.targetProfileUserId,
                    "ban",
                );
                break;
            // An alert will be emitted below
            case ReportHandleAction.ALERT:
                break;
            case ReportHandleAction.DISCARD:
                await this.close(
                    handlerUserId,
                    reportId,
                    ReportHandleAction.DISCARD,
                );
                return;
        }
        // ...Action is different from DISCARD

        if (deleteReportedContent) {
            if (report.targetReviewId != undefined) {
                await this.reviewsService.delete(
                    report.targetProfileUserId,
                    report.targetReviewId,
                );
            }
            if (report.targetReviewCommentId != undefined) {
                await this.commentService.delete(
                    report.targetProfileUserId,
                    report.targetReviewCommentId,
                    {
                        sourceType: CommentSourceType.REVIEW,
                    },
                );
            }
        }

        this.notificationsQueueService.registerNotification({
            sourceId: report.id,
            userId: undefined,
            sourceType: ENotificationSourceType.REPORT,
            category: ENotificationCategory.ALERT,
            targetUserId: report.targetProfileUserId,
        });

        await this.close(handlerUserId, reportId, action);
    }

    private async close(
        handlerUserId: string,
        reportId: number,
        action: ReportHandleAction,
    ) {
        await this.reportRepository.update(
            {
                id: reportId,
            },
            {
                closeProfileUserId: handlerUserId,
                closeHandleAction: action,
                isClosed: true,
            },
        );
    }
}
