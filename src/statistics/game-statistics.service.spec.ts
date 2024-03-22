import { Test, TestingModule } from '@nestjs/testing';
import { GameStatisticsService } from './game-statistics.service';

describe('GameStatisticsService', () => {
  let service: GameStatisticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GameStatisticsService],
    }).compile();

    service = module.get<GameStatisticsService>(GameStatisticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
