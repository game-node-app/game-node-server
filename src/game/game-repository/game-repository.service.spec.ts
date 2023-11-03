import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { GameRepositoryService } from "./game-repository.service";

describe("GameSearchService", () => {
    let service: GameRepositoryService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [ConfigModule.forRoot()],
            providers: [GameRepositoryService],
        }).compile();

        service = module.get<GameRepositoryService>(GameRepositoryService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
