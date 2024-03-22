import { Test, TestingModule } from '@nestjs/testing';
import { HltbController } from './hltb.controller';

describe('HltbController', () => {
  let controller: HltbController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HltbController],
    }).compile();

    controller = module.get<HltbController>(HltbController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
