import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { FollowService } from "./follow.service";
import { UserFollow } from "./entity/user-follow.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { randomUUID } from "crypto";
import { achievementFixtures } from "../../test/achievements/achievement-fixtures";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { ObtainedAchievement } from "../achievements/entities/obtained-achievement.entity";


describe("FollowService integration (Task 5.2)", () => {
    let dataSource: DataSource;
    let service: FollowService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        const repo = dataSource.getRepository(UserFollow);
        service = new FollowService(repo, dataSource);
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

    it("appends follow intent only for a newly committed relationship", async () => {
        const follower = randomUUID();
        const followed = randomUUID();

        await createMockProfile(follower);
        await createMockProfile(followed);

        const result = await service.registerFollow(follower, followed);
        expect(result).toBeDefined();

        const outboxItems = await dataSource.getRepository(NotificationOutbox).find({
            where: {
                actorUserId: follower,
                recipientUserId: followed,
                eventType: "profile.followed",
            },
        });

        expect(outboxItems).toHaveLength(1);
        expect(outboxItems[0].payload.followId).toBeDefined();

        // Repeated follow request
        const repeatedResult = await service.registerFollow(follower, followed);
        expect(repeatedResult).toBeDefined();

        // No additional event created!
        const outboxAfter = await dataSource.getRepository(NotificationOutbox).find({
            where: {
                actorUserId: follower,
                recipientUserId: followed,
                eventType: "profile.followed",
            },
        });
        expect(outboxAfter).toHaveLength(1);
    });

    it("handles concurrent follow requests without duplicating events", async () => {
        const follower = randomUUID();
        const followed = randomUUID();

        await createMockProfile(follower);
        await createMockProfile(followed);

        // Run concurrent follow requests
        const [res1, res2] = await Promise.all([
            service.registerFollow(follower, followed),
            service.registerFollow(follower, followed),
        ]);

        expect(res1).toBeDefined();
        expect(res2).toBeDefined();

        const outboxItems = await dataSource.getRepository(NotificationOutbox).find({
            where: {
                actorUserId: follower,
                recipientUserId: followed,
                eventType: "profile.followed",
            },
        });

        expect(outboxItems).toHaveLength(1);

        const followRecords = await dataSource.getRepository(UserFollow).find({
            where: {
                followerUserId: follower,
                followedUserId: followed,
            },
        });
        expect(followRecords).toHaveLength(1);
    });

    it("rejects self-follow with I_AM_A_TEAPOT and emits no intent", async () => {
        const user = randomUUID();
        await createMockProfile(user);

        await expect(service.registerFollow(user, user)).rejects.toThrow("User can't follow itself.");

        const outbox = await dataSource.getRepository(NotificationOutbox).findOne({
            where: { actorUserId: user },
        });
        expect(outbox).toBeNull();
    });

    it("evaluates followers of the followed user, granting the 10 followers tier", async () => {
        const f = achievementFixtures(dataSource);
        const definition = await f.definition("followers", {}, [[10, 50]]);
        const jobs: Array<{ userId: string; metric: string }> = [];
        const tracked = new FollowService(
            dataSource.getRepository(UserFollow),
            dataSource,
            undefined,
            { addTrackingJob: (job: any) => jobs.push(job) } as any,
        );
        const progress = new AchievementsProgressService(
            dataSource,
            new LevelService(dataSource.getRepository(UserLevel)),
            { register: jest.fn() } as any,
        );
        const followed = await f.user();
        const followers: string[] = [];
        for (let i = 0; i < 10; i++) followers.push(await f.user());

        for (const follower of followers) await tracked.registerFollow(follower, followed);
        await tracked.removeFollow(followers[0], followed);
        await tracked.registerFollow(followers[0], followed);

        expect(jobs).toHaveLength(12);
        expect(jobs.every((job) => job.userId === followed && job.metric === "followers")).toBe(true);
        await progress.evaluate(followed, "followers");
        expect(
            await dataSource.getRepository(ObtainedAchievement).findBy({
                profileUserId: followed,
                achievementId: definition.id,
            }),
        ).toEqual([expect.objectContaining({ tier: 1 })]);
    });
});
