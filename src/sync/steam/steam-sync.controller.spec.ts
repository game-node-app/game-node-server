import { Test, TestingModule } from "@nestjs/testing";
import { SteamSyncController } from "./steam-sync.controller";

describe("SteamController", () => {
    let controller: SteamSyncController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SteamSyncController],
        }).compile();

        controller = module.get<SteamSyncController>(SteamSyncController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
