import { Test, TestingModule } from "@nestjs/testing";
import { GameSearchService } from "./game-search.service";

describe("GameSearchService", () => {
    let service: GameSearchService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [GameSearchService],
        }).compile();

        service = module.get<GameSearchService>(GameSearchService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
