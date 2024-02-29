import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { GameRepositoryService } from "./game-repository.service";
import { getMockRepositoryProvider } from "../../../test/mocks/repositoryMocks";
import { Game } from "./entities/game.entity";
import { getDataSourceToken } from "@nestjs/typeorm";
import { dataSourceMock } from "../../../test/mocks/dataSource.mock";

describe("GameSearchService", () => {
    let service: GameRepositoryService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [ConfigModule.forRoot()],
            providers: [
                GameRepositoryService,
                getMockRepositoryProvider(Game),
                {
                    provide: getDataSourceToken(),
                    useValue: dataSourceMock,
                },
            ],
        }).compile();

        service = module.get<GameRepositoryService>(GameRepositoryService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
