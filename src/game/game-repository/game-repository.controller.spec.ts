import { Test, TestingModule } from "@nestjs/testing";
import { GameRepositoryController } from "./game-repository.controller";

describe("GameRepositoryController", () => {
    let controller: GameRepositoryController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [GameRepositoryController],
        }).compile();

        controller = module.get<GameRepositoryController>(
            GameRepositoryController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
