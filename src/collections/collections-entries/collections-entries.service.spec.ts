import { Test, TestingModule } from "@nestjs/testing";
import { CollectionsEntriesService } from "./collections-entries.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { ReviewsService } from "../../reviews/reviews.service";
import { Repository } from "typeorm";
import { Review } from "../../reviews/entities/review.entity";
import { CreateCollectionEntryDto } from "./dto/create-collection-entry.dto";
import { EGamePlatformIds } from "../../game/game-repository/game-repository.constants";
import { getMockRepositoryProvider } from "../../../test/mocks/repositoryMocks";
import Mocked = jest.Mocked;
import { ActivitiesQueueMock } from "../../../test/mocks/queue/activities-mocks";
import { AchievementsQueueService } from "../../achievements/achievements-queue/achievements-queue.service";
import { achievementsQueueMock } from "../../../test/mocks/queue/achievements-mocks";

describe("CollectionsEntriesService", () => {
    let service: jest.Mocked<CollectionsEntriesService>;
    let repository: jest.Mocked<Repository<CollectionEntry>>;
    let reviewService: jest.Mocked<ReviewsService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                getMockRepositoryProvider(CollectionEntry),
                CollectionsEntriesService,
                {
                    provide: ActivitiesQueueService,
                    useValue: ActivitiesQueueMock,
                },
                {
                    provide: AchievementsQueueService,
                    useValue: achievementsQueueMock,
                },
                {
                    provide: ReviewsService,
                    useValue: {
                        findOneByUserIdAndGameId: jest.fn(),
                        delete: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<Mocked<CollectionsEntriesService>>(
            CollectionsEntriesService,
        );
        reviewService = module.get<Mocked<ReviewsService>>(ReviewsService);
        repository = module.get<Mocked<Repository<CollectionEntry>>>(
            getRepositoryToken(CollectionEntry),
        );
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should change favorite status", async () => {
        const mockCollectionEntry = new CollectionEntry();
        mockCollectionEntry.id = "123124";
        mockCollectionEntry.isFavorite = false;
        jest.spyOn(
            service,
            "findOneByUserIdAndGameIdOrFail",
        ).mockImplementationOnce(async () => {
            return mockCollectionEntry;
        });
        const updateSpy = jest.spyOn(repository, "update");
        await service.changeFavoriteStatus("12345", 12345, true);
        expect(updateSpy).toHaveBeenCalledWith(
            {
                id: mockCollectionEntry.id,
            },
            expect.objectContaining({
                isFavorite: true,
            }),
        );
    });

    it("should keep favorite parameter when re-creating entry", async () => {
        const userId = "1";
        const dto: CreateCollectionEntryDto = {
            isFavorite: true,
            gameId: 1942,
            collectionIds: ["111111"],
            platformIds: [EGamePlatformIds.PC.valueOf()],
        };
        jest.spyOn(
            reviewService,
            "findOneByUserIdAndGameId",
        ).mockImplementation(() => {
            return Promise.resolve({} as Review);
        });
        jest.spyOn(repository, "save").mockImplementationOnce(async () => {
            return { id: "12345" } as CollectionEntry;
        });
        const replaceSpy = jest.spyOn(service, "createOrUpdate");
        const repositorySaveSpy = jest.spyOn(repository, "save");
        await service.createOrUpdate(userId, dto);
        expect(replaceSpy).toHaveReturned();
        expect(repositorySaveSpy).toBeCalledWith(
            expect.objectContaining({
                isFavorite: true,
            }),
        );
    });
});
