import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { ReportService } from "./report.service";
import { Report } from "./entity/report.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { UserSuspension } from "../suspension/entity/user-suspension.entity";
import { ReportHandleAction, ReportSourceType } from "./report.constants";
import { randomUUID } from "crypto";
import * as outboxModule from "../notifications/notifications-outbox.service";
import { NotificationsLifecycleService } from "../notifications/notifications-lifecycle.service";
import { NotificationEvent } from "../notifications/entity/notification-event.entity";
import { NotificationInbox } from "../notifications/entity/notification-inbox.entity";

describe("ReportService moderation integration (Task 5.4)", () => {
    let dataSource: DataSource;
    let service: ReportService;
    let mockSuspensionService: any;
    let mockReviewsService: any;
    let mockCommentService: any;
    let mockPostsService: any;
    let lifecycle: NotificationsLifecycleService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();

        mockSuspensionService = {
            checkBanPermission: jest.fn().mockResolvedValue(undefined),
            create: jest.fn(),
        };
        mockReviewsService = { delete: jest.fn() };
        mockCommentService = { delete: jest.fn() };
        mockPostsService = { delete: jest.fn() };
        lifecycle = new NotificationsLifecycleService(
            dataSource.getRepository(NotificationInbox),
            dataSource.getRepository(NotificationEvent),
            dataSource,
        );

        service = new ReportService(
            dataSource.getRepository(Report),
            mockReviewsService,
            mockCommentService,
            mockSuspensionService,
            mockPostsService,
            dataSource,
            lifecycle,
        );
    });

    afterAll(async () => {
        if (dataSource && dataSource.isInitialized) {
            await dataSource.destroy();
        }
    });

    async function createMockProfile(userId: string) {
        await dataSource.query(
            `INSERT INTO profile (userId, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE userId = userId`,
            [userId, `user_${userId.slice(0, 8)}`],
        );
    }

    async function createReport(reporter: string, reported: string) {
        const repo = dataSource.getRepository(Report);
        const report = repo.create({
            profileUserId: reporter,
            targetProfileUserId: reported,
            sourceType: ReportSourceType.PROFILE,
            category: 1 as any,
            reason: "Secret internal reporter reason",
            isClosed: false,
        });
        return await repo.save(report);
    }

    it.each(["post", "comment"])(
        "commits %s removal, invalidation and report closure together and rolls them all back on failure",
        async (kind) => {
            const reported = randomUUID(),
                reporter = randomUUID(),
                moderator = randomUUID();
            for (const user of [reported, reporter, moderator])
                await createMockProfile(user);
            const post = randomUUID(),
                removedComment = randomUUID(),
                keptComment = randomUUID();
            await dataSource.query(
                "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Moderated post')",
                [post, reported],
            );
            await dataSource.query(
                "INSERT INTO post_comment (id, profileUserId, postId, content) VALUES (?, ?, ?, 'Remove excerpt'), (?, ?, ?, 'Keep excerpt')",
                [removedComment, reported, post, keptComment, reporter, post],
            );
            const groupKey = randomUUID();
            for (const id of [keptComment, removedComment])
                await dataSource.getRepository(NotificationEvent).save({
                    eventId: randomUUID(),
                    recipientUserId: reporter,
                    groupKey,
                    eventType: "comment.created",
                    actorUserId: reported,
                    rootType: "post",
                    rootId: post,
                    subjectType: "post",
                    subjectId: post,
                    triggerCommentId: id,
                    preview: { text: "Remove excerpt" },
                    target: { type: "post", id: post, focusId: id },
                    occurredAt: new Date(),
                });
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const inbox = await inboxRepo.save({
                recipientUserId: reporter,
                groupKey,
                type: "comment.created",
                rootType: "post",
                rootId: post,
                subjectType: "post",
                subjectId: post,
                triggerCommentId: removedComment,
                actorIds: [reported],
                actorCount: 1,
                eventCount: 2,
                version: 2,
                readVersion: 1,
                preview: { text: "Remove excerpt" },
                target: { type: "post", id: post, focusId: removedComment },
                lastEventAt: new Date(),
            });
            const report = await dataSource
                .getRepository(Report)
                .save({
                    profileUserId: reporter,
                    targetProfileUserId: reported,
                    sourceType:
                        kind === "post"
                            ? ReportSourceType.POST
                            : ReportSourceType.POST_COMMENT,
                    category: 1 as any,
                    reason: "Internal reason",
                    targetPostId: kind === "post" ? post : null,
                    targetPostCommentId:
                        kind === "comment" ? removedComment : null,
                });
            const method =
                kind === "post" ? "invalidateContent" : "invalidateComment";
            const failure = jest
                .spyOn(lifecycle, method)
                .mockRejectedValueOnce(new Error("invalidation unavailable"));
            await expect(
                service.handle(moderator, report.id, {
                    action: ReportHandleAction.ALERT,
                    deleteReportedContent: true,
                }),
            ).rejects.toThrow("invalidation unavailable");
            failure.mockRestore();
            expect(
                await dataSource.query("SELECT id FROM post WHERE id = ?", [
                    post,
                ]),
            ).toHaveLength(1);
            expect(
                await dataSource.query(
                    "SELECT id FROM post_comment WHERE id = ?",
                    [removedComment],
                ),
            ).toHaveLength(1);
            expect(
                await inboxRepo.findOneByOrFail({ id: inbox.id }),
            ).toMatchObject({
                isVisible: true,
                readVersion: 1,
                preview: { text: "Remove excerpt" },
            });
            expect(
                await dataSource
                    .getRepository(Report)
                    .findOneByOrFail({ id: report.id }),
            ).toMatchObject({ isClosed: false });
            expect(
                await dataSource
                    .getRepository(NotificationOutbox)
                    .countBy({ recipientUserId: reported }),
            ).toBe(0);

            await service.handle(moderator, report.id, {
                action: ReportHandleAction.ALERT,
                deleteReportedContent: true,
            });
            expect(
                await dataSource
                    .getRepository(Report)
                    .findOneByOrFail({ id: report.id }),
            ).toMatchObject({ isClosed: true });
            const after = await inboxRepo.findOneByOrFail({ id: inbox.id });
            expect(after.readVersion).toBe(1);
            if (kind === "post") expect(after.isVisible).toBe(false);
            else {
                expect(after).toMatchObject({
                    isVisible: true,
                    isRedacted: true,
                    triggerCommentId: null,
                    preview: { text: "[Comment deleted]" },
                });
                expect(after.target).not.toHaveProperty("focusId");
                expect(
                    await dataSource.query(
                        "SELECT id FROM post_comment WHERE id = ?",
                        [keptComment],
                    ),
                ).toHaveLength(1);
            }
        },
    );

    it("delivers moderation alert with system actor (null) and safe payload, excluding reporter/internal data", async () => {
        const reporter = randomUUID();
        const reported = randomUUID();
        const moderator = randomUUID();

        await createMockProfile(reporter);
        await createMockProfile(reported);
        await createMockProfile(moderator);

        const report = await createReport(reporter, reported);

        await service.handle(moderator, report.id, {
            action: ReportHandleAction.ALERT,
            deleteReportedContent: false,
        });

        // Verify report is closed
        const updated = await dataSource
            .getRepository(Report)
            .findOneBy({ id: report.id });
        expect(updated?.isClosed).toBe(true);
        expect(updated?.closeProfileUserId).toBe(moderator);

        // Verify outbox intent
        const outbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOne({
                where: {
                    recipientUserId: reported,
                    eventType: "moderation.applied",
                },
                order: { createdAt: "DESC" },
            });

        expect(outbox).not.toBeNull();
        expect(outbox?.actorUserId).toBeNull(); // SYSTEM actor! Reporter / moderator ID not exposed!
        expect(outbox?.payload?.action).toBe("alert");
        expect(outbox?.payload?.reportId).toBe(report.id);
        // Excludes reporter identity and internal notes
        expect(outbox?.payload?.reason).toBeUndefined();
        expect(outbox?.payload?.reporterUserId).toBeUndefined();
    });

    it("creates suspension and moderation outbox intent atomically", async () => {
        const reporter = randomUUID();
        const reported = randomUUID();
        const moderator = randomUUID();

        await createMockProfile(reporter);
        await createMockProfile(reported);
        await createMockProfile(moderator);

        const report = await createReport(reporter, reported);

        await service.handle(moderator, report.id, {
            action: ReportHandleAction.SUSPEND,
            deleteReportedContent: false,
        });

        const suspensions = await dataSource
            .getRepository(UserSuspension)
            .find({
                where: { userId: reported },
            });
        expect(suspensions).toHaveLength(1);
        expect(suspensions[0].isSuspension).toBe(true);

        const outbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOne({
                where: {
                    recipientUserId: reported,
                    eventType: "moderation.applied",
                },
                order: { createdAt: "DESC" },
            });

        expect(outbox?.payload?.action).toBe("suspension");
        expect(outbox?.actorUserId).toBeNull();
    });

    it("emits nothing when action is DISCARD", async () => {
        const reporter = randomUUID();
        const reported = randomUUID();
        const moderator = randomUUID();

        await createMockProfile(reporter);
        await createMockProfile(reported);
        await createMockProfile(moderator);

        const report = await createReport(reporter, reported);

        await service.handle(moderator, report.id, {
            action: ReportHandleAction.DISCARD,
            deleteReportedContent: false,
        });

        const updated = await dataSource
            .getRepository(Report)
            .findOneBy({ id: report.id });
        expect(updated?.isClosed).toBe(true);
        expect(updated?.closeHandleAction).toBe(ReportHandleAction.DISCARD);

        const outbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOne({
                where: {
                    recipientUserId: reported,
                    eventType: "moderation.applied",
                },
            });
        expect(outbox).toBeNull();
    });

    it("rolls back transaction and emits no alert if intent append fails", async () => {
        const reporter = randomUUID();
        const reported = randomUUID();
        const moderator = randomUUID();

        await createMockProfile(reporter);
        await createMockProfile(reported);
        await createMockProfile(moderator);

        const report = await createReport(reporter, reported);

        const spy = jest
            .spyOn(outboxModule, "appendNotificationIntent")
            .mockRejectedValueOnce(new Error("Outbox intent failure"));

        try {
            await expect(
                service.handle(moderator, report.id, {
                    action: ReportHandleAction.SUSPEND,
                    deleteReportedContent: false,
                }),
            ).rejects.toThrow("Outbox intent failure");

            // Report remains OPEN!
            const checkReport = await dataSource
                .getRepository(Report)
                .findOneBy({ id: report.id });
            expect(checkReport?.isClosed).toBe(false);

            // No suspension created!
            const suspensions = await dataSource
                .getRepository(UserSuspension)
                .find({
                    where: { userId: reported },
                });
            expect(suspensions).toHaveLength(0);
        } finally {
            spy.mockRestore();
        }
    });
});
