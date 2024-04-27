import { Test, TestingModule } from "@nestjs/testing";
import { SteamSyncService } from "./steam-sync.service";

describe("SteamService", () => {
    let service: SteamSyncService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [SteamSyncService],
        }).compile();

        service = module.get<SteamSyncService>(SteamSyncService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
