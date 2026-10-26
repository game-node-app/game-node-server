import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { FollowService } from "./follow.service";
import { UserFollow } from "./entity/user-follow.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { randomUUID } from "crypto";


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
});
