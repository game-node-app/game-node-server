import { Test, TestingModule } from '@nestjs/testing';
import { HltbQueueService } from './hltb-queue.service';

describe('HltbQueueService', () => {
  let service: HltbQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HltbQueueService],
    }).compile();

    service = module.get<HltbQueueService>(HltbQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
