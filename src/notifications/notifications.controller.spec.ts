import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsController } from "./notifications.controller";
import { ThrottlerGuard } from "@nestjs/throttler";

describe("NotificationsController", () => {
    let controller: NotificationsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [NotificationsController],
            providers: [
                {
                    provide: ThrottlerGuard,
                    useValue: {},
                },
            ],
        }).compile();

        controller = module.get<NotificationsController>(
            NotificationsController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
