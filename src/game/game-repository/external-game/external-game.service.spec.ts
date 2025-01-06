import { Test, TestingModule } from '@nestjs/testing';
import { ExternalGameService } from './external-game.service';

describe('ExternalGameService', () => {
  let service: ExternalGameService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExternalGameService],
    }).compile();

    service = module.get<ExternalGameService>(ExternalGameService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
