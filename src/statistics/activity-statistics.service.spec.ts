import { Test, TestingModule } from '@nestjs/testing';
import { ActivityStatisticsService } from './activity-statistics.service';

describe('ActivityStatisticsService', () => {
  let service: ActivityStatisticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ActivityStatisticsService],
    }).compile();

    service = module.get<ActivityStatisticsService>(ActivityStatisticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
