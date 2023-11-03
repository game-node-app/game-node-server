import { Test, TestingModule } from "@nestjs/testing";
import { GameSearchService } from "./game-search.service";
import { ConfigModule } from "@nestjs/config";
import { GameSearchController } from "./game-search.controller";

describe("GameSearchService", () => {
    let service: GameSearchService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [ConfigModule.forRoot()],
            controllers: [GameSearchController],
            providers: [GameSearchService],
        }).compile();

        service = module.get<GameSearchService>(GameSearchService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
