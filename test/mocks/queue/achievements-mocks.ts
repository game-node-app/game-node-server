import { AchievementsQueueService } from "../../../src/achievements/achievements-queue/achievements-queue.service";
import Mocked = jest.Mocked;

export const achievementsQueueMock = {
    achievementQueue: {} as any,
    addTrackingJob: jest.fn(),
} as unknown as Mocked<AchievementsQueueService>;
