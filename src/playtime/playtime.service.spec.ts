import { Test, TestingModule } from '@nestjs/testing';
import { PlaytimeService } from './playtime.service';

describe('PlaytimeService', () => {
  let service: PlaytimeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlaytimeService],
    }).compile();

    service = module.get<PlaytimeService>(PlaytimeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
