import { Test, TestingModule } from '@nestjs/testing';
import { CollectionsEntriesService } from './collections-entries.service';

describe('CollectionsEntriesService', () => {
  let service: CollectionsEntriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CollectionsEntriesService],
    }).compile();

    service = module.get<CollectionsEntriesService>(CollectionsEntriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
