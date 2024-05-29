import { Test, TestingModule } from '@nestjs/testing';
import { ImporterWatchService } from './importer-watch.service';

describe('ImporterWatchService', () => {
  let service: ImporterWatchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ImporterWatchService],
    }).compile();

    service = module.get<ImporterWatchService>(ImporterWatchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
