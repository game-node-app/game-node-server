import { DataSource } from "typeorm";
import { UnrecoverableError } from "bullmq";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { achievementFixtures } from "../../test/achievements/achievement-fixtures";
import { ActivitiesRepositoryService } from "../activities/activities-repository/activities-repository.service";
import { Activity } from "../activities/activities-repository/entities/activity.entity";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";
import { AchievementsProgressService } from "./achievements-progress.service";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { CommentService } from "../comment/comment.service";
import { CommentSourceType } from "../comment/comment.constants";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { lockNotificationRoot } from "../notifications/notifications-lifecycle.service";
import { materializeNotificationTarget } from "../notifications/notifications-projector.service";

describe("ACHIEVEMENT_UNLOCKED activities (integration)", () => {
    let ds: DataSource;
    let f: ReturnType<typeof achievementFixtures>;
    let activities: ActivitiesRepositoryService;
    let progress: AchievementsProgressService;
    const registered: any[] = [];

    beforeAll(async () => {
        ds = await createNotificationTestDataSource();
        f = achievementFixtures(ds);
        activities = new ActivitiesRepositoryService(
            ds.getRepository(Activity),
            {} as any,
            {} as any,
            {} as any,
            { getLockoutStates: async () => new Map() } as any,
            {} as any,
            {} as any,
        );
        // Stands in for the activities queue, which calls ActivitiesRepositoryService.create
        progress = new AchievementsProgressService(
            ds,
            new LevelService(ds.getRepository(UserLevel)),
            { register: (dto: any) => registered.push(dto) } as any,
        );
    });

    afterAll(() => ds?.destroy());

    it("a live unlock creates one activity that accepts comments and likes", async () => {
        const owner = await f.user();
        const commenter = await f.user();
        const definition = await f.definition("manual", {}, [
            [1, 0],
            [2, 0],
        ]);
        await progress.grantTiers(owner, definition, [1, 2], "live");
        expect(registered).toHaveLength(1);

        const activity = await activities.create(registered[0]);
        expect(activity).toMatchObject({
            type: ActivityType.ACHIEVEMENT_UNLOCKED,
            profileUserId: owner,
            obtainedAchievementId: registered[0].sourceId,
        });
        await expect(activities.create(registered[0])).rejects.toBeInstanceOf(
            UnrecoverableError,
        );
        expect(
            await ds.getRepository(Activity).countBy({ profileUserId: owner }),
        ).toBe(1);

        await new CommentService(ds).create(commenter, {
            sourceType: CommentSourceType.ACTIVITY,
            sourceId: activity.id,
            content: "Congrats!",
        });
        expect(
            await ds.getRepository(NotificationOutbox).countBy({
                recipientUserId: owner,
                actorUserId: commenter,
                eventType: "comment.created",
            }),
        ).toBe(1);

        // Likes resolve the activity root the same way when projected
        await ds.transaction(async (manager) => {
            const root = await lockNotificationRoot(
                manager,
                "activity",
                activity.id,
            );
            expect(root).toMatchObject({ profileUserId: owner });
            expect(
                await materializeNotificationTarget(
                    manager,
                    "activity",
                    activity.id,
                    root,
                ),
            ).toMatchObject({
                activityType: ActivityType.ACHIEVEMENT_UNLOCKED,
                content: {
                    type: "platform_achievement",
                    id: String(registered[0].sourceId),
                },
            });
        });
    });

    it("backfill grants register no activity", async () => {
        registered.length = 0;
        const user = await f.user();
        const game = await f.game();
        await f.review(user, game);
        const definition = await f.definition(
            "reviews_written",
            { gameIds: [game] },
            [[1, 0]],
        );

        await progress.backfill(definition.id, null);

        expect(registered).toHaveLength(0);
    });
});
