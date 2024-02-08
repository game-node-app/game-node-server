import { Test, TestingModule } from "@nestjs/testing";
import { GameRepositoryController } from "./game-repository.controller";
import { GameRepositoryService } from "./game-repository.service";

describe("GameRepositoryController", () => {
    let controller: GameRepositoryController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [GameRepositoryController],
            providers: [
                {
                    provide: GameRepositoryService,
                    useValue: {},
                },
            ],
        }).compile();

        controller = module.get<GameRepositoryController>(
            GameRepositoryController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
