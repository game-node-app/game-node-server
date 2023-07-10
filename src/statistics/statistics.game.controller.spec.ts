import { Test, TestingModule } from '@nestjs/testing';
import { StatisticsGameController } from './statistics.game.controller';

describe('StatisticsGameController', () => {
  let controller: StatisticsGameController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatisticsGameController],
    }).compile();

    controller = module.get<StatisticsGameController>(StatisticsGameController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
