import { Test, TestingModule } from '@nestjs/testing';
import { HltbService } from './hltb.service';

describe('HltbService', () => {
  let service: HltbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HltbService],
    }).compile();

    service = module.get<HltbService>(HltbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
