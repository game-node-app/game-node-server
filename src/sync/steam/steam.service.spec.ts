import { Test, TestingModule } from "@nestjs/testing";
import { SteamService } from "./steam.service";

describe("SteamService", () => {
    let service: SteamService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [SteamService],
        }).compile();

        service = module.get<SteamService>(SteamService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
