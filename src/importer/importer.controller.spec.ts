import { Test, TestingModule } from '@nestjs/testing';
import { ImporterController } from './importer.controller';

describe('ImporterController', () => {
  let controller: ImporterController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImporterController],
    }).compile();

    controller = module.get<ImporterController>(ImporterController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
