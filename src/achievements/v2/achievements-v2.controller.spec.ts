import { Test, TestingModule } from '@nestjs/testing';
import { AchievementsV2Controller } from './achievements-v2.controller';

describe('AchievementsV2Controller', () => {
  let controller: AchievementsV2Controller;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AchievementsV2Controller],
    }).compile();

    controller = module.get<AchievementsV2Controller>(AchievementsV2Controller);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
