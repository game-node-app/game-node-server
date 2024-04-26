import { Test, TestingModule } from '@nestjs/testing';
import { ImporterService } from './importer.service';

describe('ImporterService', () => {
  let service: ImporterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ImporterService],
    }).compile();

    service = module.get<ImporterService>(ImporterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
