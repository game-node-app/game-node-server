import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsQueueService } from './notifications-queue.service';

describe('NotificationsQueueService', () => {
  let service: NotificationsQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsQueueService],
    }).compile();

    service = module.get<NotificationsQueueService>(NotificationsQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
