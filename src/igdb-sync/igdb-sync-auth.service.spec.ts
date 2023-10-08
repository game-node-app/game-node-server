import { Test, TestingModule } from "@nestjs/testing";
import { IgdbSyncAuthService } from "./igdb-sync-auth.service";

describe("IgdbSyncAuthService", () => {
    let service: IgdbSyncAuthService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [IgdbSyncAuthService],
        }).compile();

        service = module.get<IgdbSyncAuthService>(IgdbSyncAuthService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
