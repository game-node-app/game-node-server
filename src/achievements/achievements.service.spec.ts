import { Test, TestingModule } from "@nestjs/testing";
import { AchievementsService } from "./achievements.service";
import {
    getMockRepositoryProvider,
    mockRepository,
} from "../../test/mocks/repositoryMocks";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { DataSource, Repository } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import { AchievementCategory } from "./achievements.constants";
import Mocked = jest.Mocked;
import sleep from "../utils/sleep";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";

describe("AchievementsService", () => {
    let service: AchievementsService;
    let dataSource: Mocked<DataSource>;
    let obtainedAchievementRepository: Mocked<Repository<ObtainedAchievement>>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AchievementsService,
                getMockRepositoryProvider(ObtainedAchievement),
                {
                    provide: DataSource,
                    useValue: {
                        getRepository: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<AchievementsService>(AchievementsService);
        dataSource = module.get(DataSource);
        obtainedAchievementRepository = module.get(
            getRepositoryToken(ObtainedAchievement),
        );
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should successfully register a new obtained achievement", async () => {
        const targetUserId = "12345";
        const mockedRepository = mockRepository as unknown as Mocked<
            Repository<any>
        >;
        obtainedAchievementRepository.create.mockReturnValue(
            new ObtainedAchievement(),
        );
        mockedRepository.find.mockResolvedValue([new CollectionEntry()]);

        dataSource.getRepository.mockImplementation(() => mockedRepository);
        mockedRepository.countBy.mockResolvedValueOnce(100);
        service.trackAchievementsProgress(
            targetUserId,
            AchievementCategory.COLLECTIONS,
        );
        // Timeout to wait for internal promises to finish
        await sleep(2000);
        expect(obtainedAchievementRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "space-station",
            }),
        );
    });
});
