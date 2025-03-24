import { Test, TestingModule } from '@nestjs/testing';
import { TurnstileService } from './turnstile.service';

describe('TurnstileService', () => {
  let service: TurnstileService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TurnstileService],
    }).compile();

    service = module.get<TurnstileService>(TurnstileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
