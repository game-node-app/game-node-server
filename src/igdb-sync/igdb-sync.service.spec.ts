import { Test, TestingModule } from "@nestjs/testing";
import { IgdbSyncService } from "./igdb-sync.service";

describe("IgdbSyncService", () => {
    let service: IgdbSyncService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [IgdbSyncService],
        }).compile();

        service = module.get<IgdbSyncService>(IgdbSyncService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
