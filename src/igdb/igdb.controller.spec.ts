import { Test, TestingModule } from '@nestjs/testing';
import { IgdbController } from './igdb.controller';
import { IgdbService } from './igdb.service';

describe('IgdbController', () => {
  let controller: IgdbController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IgdbController],
      providers: [IgdbService],
    }).compile();

    controller = module.get<IgdbController>(IgdbController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
