import { Test, TestingModule } from "@nestjs/testing";
import { IgdbSyncService } from "./igdb-sync.service";
import { getQueueToken } from "@nestjs/bullmq";
import { IGDB_SYNC_QUEUE_NAME } from "./igdb-sync.constants";

describe("IgdbSyncService", () => {
    let service: IgdbSyncService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                IgdbSyncService,
                {
                    provide: getQueueToken(IGDB_SYNC_QUEUE_NAME),
                    useValue: {
                        add: jest.fn(async () => {}),
                    },
                },
            ],
        }).compile();

        service = module.get<IgdbSyncService>(IgdbSyncService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
