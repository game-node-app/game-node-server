import { Test, TestingModule } from '@nestjs/testing';
import { PlaytimeController } from './playtime.controller';

describe('PlaytimeController', () => {
  let controller: PlaytimeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlaytimeController],
    }).compile();

    controller = module.get<PlaytimeController>(PlaytimeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
