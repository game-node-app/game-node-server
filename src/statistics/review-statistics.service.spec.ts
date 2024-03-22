import { Test, TestingModule } from '@nestjs/testing';
import { ReviewStatisticsService } from './review-statistics.service';

describe('ReviewStatisticsService', () => {
  let service: ReviewStatisticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReviewStatisticsService],
    }).compile();

    service = module.get<ReviewStatisticsService>(ReviewStatisticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
