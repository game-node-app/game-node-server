import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { achievementFixtures } from "../../test/achievements/achievement-fixtures";
import { NotificationsService } from "./notifications.service";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationsProjectorService } from "./notifications-projector.service";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { Profile } from "../profile/entities/profile.entity";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { ObtainedAchievement } from "../achievements/entities/obtained-achievement.entity";
import { validateNotificationIntent } from "./notifications-outbox.service";

describe("achievement.unlocked notifications (integration)", () => {
    let ds: DataSource;
    let f: ReturnType<typeof achievementFixtures>;
    let levelService: LevelService;
    let progress: AchievementsProgressService;
    let projector: NotificationsProjectorService;
    let notifications: NotificationsService;

    const outboxOf = (userId: string) =>
        ds.getRepository(NotificationOutbox).find({
            where: {
                recipientUserId: userId,
                eventType: "achievement.unlocked",
            },
        });

    beforeAll(async () => {
        ds = await createNotificationTestDataSource();
        f = achievementFixtures(ds);
        levelService = new LevelService(ds.getRepository(UserLevel));
        progress = new AchievementsProgressService(ds, levelService, {
            register: jest.fn(),
        } as any);
        projector = new NotificationsProjectorService(
            ds,
            new NotificationsRelayService(
                ds,
                ds.getRepository(NotificationOutbox),
                { add: jest.fn() } as any,
            ),
        );
        notifications = new NotificationsService(
            ds.getRepository(NotificationInbox),
            ds.getRepository(Profile),
            ds,
        );
    });

    afterAll(() => ds?.destroy());

    it("validates the payload", () => {
        const intent = {
            eventType: "achievement.unlocked" as const,
            eventVersion: 1,
            recipientUserId: "user",
            actorUserId: null,
            payload: {
                obtainedAchievementId: 1,
                achievementId: "boo",
                tier: 2,
            },
        };
        expect(() => validateNotificationIntent(intent)).not.toThrow();
        expect(() =>
            validateNotificationIntent({
                ...intent,
                payload: { ...intent.payload, tier: 0 },
            }),
        ).toThrow();
        expect(() =>
            validateNotificationIntent({
                ...intent,
                payload: { ...intent.payload, extra: 1 } as any,
            }),
        ).toThrow();
    });

    it("a rolled-back grant leaves neither the tier nor a notification", async () => {
        const user = await f.user();
        const definition = await f.definition("manual", {}, [[1, 10]]);
        jest.spyOn(levelService, "increaseExp").mockRejectedValueOnce(
            new Error("boom"),
        );

        await expect(
            progress.grantTiers(user, definition, [1], "live"),
        ).rejects.toThrow("boom");

        expect(
            await ds
                .getRepository(ObtainedAchievement)
                .countBy({ profileUserId: user }),
        ).toBe(0);
        expect(await outboxOf(user)).toHaveLength(0);
    });

    it("two unlocks on the same day are separate inbox items with the achievement target and tier", async () => {
        const user = await f.user();
        const first = await f.definition("manual", {}, [
            [1, 0],
            [2, 0],
        ]);
        const second = await f.definition("manual", {}, [[1, 0]]);
        await progress.grantTiers(user, first, [1, 2], "live");
        await progress.grantTiers(user, second, [1], "manual");

        const outbox = await outboxOf(user);
        expect(outbox).toHaveLength(2);
        for (const [index, row] of outbox.entries()) {
            const token = `ach-${index}-${row.id.slice(0, 8)}`;
            await ds
                .getRepository(NotificationOutbox)
                .update(
                    { id: row.id },
                    {
                        state: "processing",
                        ownerToken: token,
                        ownerExpiresAt: new Date(Date.now() + 60000),
                    },
                );
            expect(await projector.projectEvent(row.id, token)).toBe(true);
        }

        const { data: items } = await notifications.findAll(user, {
            limit: 10,
        } as any);
        expect(items).toHaveLength(2);
        expect(
            items
                .map((item: any) => item.target)
                .sort((a: any, b: any) => b.tier - a.tier),
        ).toEqual([
            { type: "achievement", id: first.id, tier: 2 },
            { type: "achievement", id: second.id, tier: 1 },
        ]);
        expect(items.map((item: any) => item.preview.text).sort()).toEqual(
            [first.name, second.name].sort(),
        );
        expect(items.every((item: any) => item.actors.length === 0)).toBe(true);
    });
});
