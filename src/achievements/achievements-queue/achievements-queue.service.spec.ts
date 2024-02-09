import { Test, TestingModule } from '@nestjs/testing';
import { AchievementsQueueService } from './achievements-queue.service';

describe('AchievementsQueueService', () => {
  let service: AchievementsQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AchievementsQueueService],
    }).compile();

    service = module.get<AchievementsQueueService>(AchievementsQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
