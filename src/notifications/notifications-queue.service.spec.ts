import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsQueueService } from "./notifications-queue.service";
import { getQueueToken } from "@nestjs/bull";

describe("NotificationsQueueService", () => {
    let service: NotificationsQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                NotificationsQueueService,
                {
                    provide: getQueueToken(""),
                    useValue: {},
                },
            ],
        }).compile();

        service = module.get<NotificationsQueueService>(
            NotificationsQueueService,
        );
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
