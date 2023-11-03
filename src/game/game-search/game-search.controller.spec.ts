import { Test, TestingModule } from "@nestjs/testing";
import { GameSearchController } from "./game-search.controller";
import { GameSearchService } from "./game-search.service";
import { GameSearchRequestDto } from "./dto/game-search-request.dto";
import { ConfigModule } from "@nestjs/config";

describe("GameSearchController", () => {
    let controller: GameSearchController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [ConfigModule.forRoot()],
            controllers: [GameSearchController],
            providers: [GameSearchService],
        }).compile();

        controller = module.get<GameSearchController>(GameSearchController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    it("should return a list of searched games", async () => {
        const dto: GameSearchRequestDto = {
            index: "gamenode",
            query: {
                query_string: "the witcher 3",
            },
        };
        const result = await controller.search(dto);

        expect(result).toBeDefined();
        expect(result.hits?.hits?.length).toBeGreaterThan(0);
    });
});
