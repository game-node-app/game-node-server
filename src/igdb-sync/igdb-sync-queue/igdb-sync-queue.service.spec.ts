import { Test, TestingModule } from "@nestjs/testing";
import { IgdbSyncQueueService } from "./igdb-sync-queue.service";

describe("IgdbSyncQueueService", () => {
    let service: IgdbSyncQueueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [IgdbSyncQueueService],
        }).compile();

        service = module.get<IgdbSyncQueueService>(IgdbSyncQueueService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
