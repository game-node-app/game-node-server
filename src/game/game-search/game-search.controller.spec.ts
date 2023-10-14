import { Test, TestingModule } from "@nestjs/testing";
import { GameSearchController } from "./game-search.controller";

describe("GameSearchController", () => {
    let controller: GameSearchController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [GameSearchController],
        }).compile();

        controller = module.get<GameSearchController>(GameSearchController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
