import {
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
    Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Report } from "./entity/report.entity";
import {
    DataSource,
    EntityManager,
    FindOptionsWhere,
    Repository,
} from "typeorm";
import { CreateReportRequestDto } from "./dto/create-report-request.dto";
import { ReportHandleAction, ReportSourceType } from "./report.constants";
import { FindLatestReportRequestDto } from "./dto/find-report-request.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { ReviewsService } from "../reviews/reviews.service";
import { HandleReportRequestDto } from "./dto/handle-report-request.dto";
import { SuspensionService } from "../suspension/suspension.service";
import { CommentService } from "../comment/comment.service";
import { CommentSourceType } from "../comment/comment.constants";
import { PostsService } from "../posts/posts.service";
import { match } from "ts-pattern";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { UserSuspension } from "../suspension/entity/user-suspension.entity";
import { Review } from "../reviews/entities/review.entity";
import { ReviewComment } from "../comment/entity/review-comment.entity";
import { Post } from "../posts/entity/post.entity";
import { PostComment } from "../comment/entity/post-comment.entity";
import { ActivityComment } from "../comment/entity/activity-comment.entity";
import { NotificationsLifecycleService } from "../notifications/notifications-lifecycle.service";
import { StatisticsSourceType } from "../statistics/statistics.constants";
import {
    deactivateStatisticsContent,
    deactivateStatisticsSource,
} from "../statistics/statistics-target.repository";

@Injectable()
export class ReportService {
    private logger = new Logger(ReportService.name);

    constructor(
        @InjectRepository(Report)
        private readonly reportRepository: Repository<Report>,
        private readonly reviewsService: ReviewsService,
        private readonly commentService: CommentService,
        private readonly suspensionService: SuspensionService,
        private readonly postsService: PostsService,
        @Optional()
        private readonly dataSource?: DataSource,
        @Optional()
        private readonly notificationsLifecycleService?: NotificationsLifecycleService,
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
        const { sourceType, sourceId, category, reason } = dto;
        const createdReport = this.reportRepository.create({
            profileUserId: userId,
            sourceType: sourceType,
            category: category,
            reason: reason,
        });

        switch (sourceType) {
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
            case ReportSourceType.POST:
                const post =
                    await this.postsService.findOneByIdOrFail(sourceId);
                createdReport.targetProfileUserId = post.profileUserId;
                createdReport.targetPostId = post.id;
                break;
            case ReportSourceType.POST_COMMENT:
                const postComment = await this.commentService.findOneByIdOrFail(
                    CommentSourceType.POST,
                    sourceId,
                );
                createdReport.targetProfileUserId = postComment.profileUserId;
                createdReport.targetPostCommentId = postComment.id;
                break;
            default:
                throw new HttpException(
                    "Unmapped report source type!",
                    HttpStatus.BAD_REQUEST,
                );
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

        if (action === ReportHandleAction.DISCARD) {
            await this.close(
                handlerUserId,
                reportId,
                ReportHandleAction.DISCARD,
            );
            return;
        }

        if (action === ReportHandleAction.BAN) {
            await this.suspensionService.checkBanPermission(handlerUserId);
        }

        const mappedAction: "alert" | "suspension" | "ban" = match(action)
            .with(ReportHandleAction.SUSPEND, () => "suspension" as const)
            .with(ReportHandleAction.BAN, () => "ban" as const)
            .with(ReportHandleAction.ALERT, () => "alert" as const)
            .exhaustive();

        const runTransaction = async (manager: EntityManager) => {
            if (
                action === ReportHandleAction.SUSPEND ||
                action === ReportHandleAction.BAN
            ) {
                const fourteenDaysFromNow = new Date();
                fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);

                const suspensionRepo = manager.getRepository(UserSuspension);
                const suspension = suspensionRepo.create({
                    isSuspension: action === ReportHandleAction.SUSPEND,
                    isBan: action === ReportHandleAction.BAN,
                    endDate: fourteenDaysFromNow,
                    issuerUserId: handlerUserId,
                    userId: report.targetProfileUserId,
                });
                await suspensionRepo.save(suspension);
            }

            if (deleteReportedContent) {
                for (const [entity, id, kind] of [
                    [Review, report.targetReviewId, "review"],
                    [Post, report.targetPostId, "post"],
                    [ReviewComment, report.targetReviewCommentId, "comment"],
                    [PostComment, report.targetPostCommentId, "comment"],
                    [
                        ActivityComment,
                        report.targetActivityCommentId,
                        "comment",
                    ],
                ] as const) {
                    if (id == null) continue;
                    const repository = manager.getRepository(entity);
                    const content = await repository.findOne({
                        where: {
                            id,
                            profileUserId: report.targetProfileUserId,
                        },
                        lock: { mode: "pessimistic_write" },
                    });
                    if (!content) continue;
                    if (kind !== "comment")
                        await this.notificationsLifecycleService?.invalidateContent(
                            kind,
                            id,
                            manager,
                        );
                    if (kind !== "comment")
                        await deactivateStatisticsContent(manager, kind, id);
                    else {
                        const sourceType = entity === ReviewComment
                            ? StatisticsSourceType.REVIEW_COMMENT
                            : entity === PostComment
                              ? StatisticsSourceType.POST_COMMENT
                              : StatisticsSourceType.ACTIVITY_COMMENT;
                        await deactivateStatisticsSource(manager, sourceType, id);
                    }
                    const removed = await repository.delete({
                        id,
                        profileUserId: report.targetProfileUserId,
                    });
                    if (removed.affected && kind === "comment")
                        await this.notificationsLifecycleService?.invalidateComment(
                            id,
                            manager,
                        );
                }
            }

            const reportRepo = manager.getRepository(Report);
            const updateResult = await reportRepo.update(
                {
                    id: reportId,
                    isClosed: false,
                },
                {
                    closeProfileUserId: handlerUserId,
                    closeHandleAction: action,
                    isClosed: true,
                },
            );

            if (updateResult.affected === 0) {
                throw new HttpException(
                    "Report is already closed or does not exist",
                    HttpStatus.BAD_REQUEST,
                );
            }

            await appendNotificationIntent(manager, {
                eventType: "moderation.applied",
                eventVersion: 1,
                occurredAt: new Date(),
                recipientUserId: report.targetProfileUserId,
                actorUserId: null,
                payload: {
                    reportId: report.id,
                    action: mappedAction,
                },
            });
        };

        if (this.dataSource?.transaction) {
            await this.dataSource.transaction(runTransaction);
        } else {
            await runTransaction(this.reportRepository.manager);
        }
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
