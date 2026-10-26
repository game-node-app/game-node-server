jest.setTimeout(60000);
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { UnrecoverableError } from "bullmq";
import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { Activity } from "./entities/activity.entity";
import { ActivitiesRepositoryService } from "./activities-repository.service";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { StatisticsTarget } from "../../statistics/entity/statistics-target.entity";
import { MetricTotal } from "../../statistics/entity/metric-total.entity";
import { StatisticsSourceType } from "../../statistics/statistics.constants";

describe("ActivitiesRepositoryService (behavioral integration)", () => {
    let dataSource: DataSource;
    let service: ActivitiesRepositoryService;
    let postsService: any;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        postsService = {
            findOneByIdOrFail: jest.fn(async (id: string) => ({
                id,
                gameId: 1,
            })),
        };
        service = new ActivitiesRepositoryService(
            dataSource.getRepository(Activity),
            {} as any,
            {} as any,
            { isMature: jest.fn().mockResolvedValue(false) } as any,
            { checkIsSuspendedOrBanned: jest.fn().mockResolvedValue(false) } as any,
            postsService,
            {
                findOneByIdOrFail: jest
                    .fn()
                    .mockResolvedValue({ externalGame: { gameId: 1 } }),
            } as any,
        );
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    async function ensureProfile(userId: string) {
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username) VALUES (?, ?)",
            [userId, `u_${userId.slice(0, 10)}`],
        );
    }

    async function ensurePost(postId: string, userId: string) {
        await ensureProfile(userId);
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Post content')",
            [postId, userId],
        );
    }

    it("creates an activity for a post and initializes its statistics target and gauge atomically", async () => {
        const userId = randomUUID();
        const postId = randomUUID();
        await ensurePost(postId, userId);

        const activity = await service.create({
            type: ActivityType.POST,
            sourceId: postId,
            profileUserId: userId,
        });

        expect(activity!.id).toBeDefined();
        expect(activity!.statisticsTargetId).toBeDefined();

        const storedActivity = await dataSource
            .getRepository(Activity)
            .findOneByOrFail({ id: activity!.id });
        expect(storedActivity.statisticsTargetId).toBe(activity!.statisticsTargetId);

        const target = await dataSource
            .getRepository(StatisticsTarget)
            .findOneByOrFail({ id: activity!.statisticsTargetId! });
        expect(target.sourceType).toBe(StatisticsSourceType.ACTIVITY);
        expect(target.isActive).toBe(true);

        const metric = await dataSource
            .getRepository(MetricTotal)
            .findOneByOrFail({
                targetId: activity!.statisticsTargetId!,
                metricCode: "likes_current",
            });
        expect(metric.metricValue).toBe(0);
    });

    it("rejects duplicate activity creation without leaking orphan targets", async () => {
        const userId = randomUUID();
        const postId = randomUUID();
        await ensurePost(postId, userId);

        const payload = {
            type: ActivityType.POST,
            sourceId: postId,
            profileUserId: userId,
        };

        const first = await service.create(payload);
        expect(first!.id).toBeDefined();

        const targetCountBefore = await dataSource.getRepository(StatisticsTarget).countBy({
            sourceType: StatisticsSourceType.ACTIVITY,
        });

        await expect(service.create(payload)).rejects.toThrow(UnrecoverableError);

        const targetCountAfter = await dataSource.getRepository(StatisticsTarget).countBy({
            sourceType: StatisticsSourceType.ACTIVITY,
        });
        expect(targetCountAfter).toBe(targetCountBefore);
    });
});
