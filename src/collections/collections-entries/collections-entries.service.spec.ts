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
import { mockRepository } from "../../../test/mocks/repositoryMocks";
import Mocked = jest.Mocked;

describe("CollectionsEntriesService", () => {
    let service: jest.Mocked<CollectionsEntriesService>;
    let repository: jest.Mocked<Repository<CollectionEntry>>;
    let reviewService: jest.Mocked<ReviewsService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: getRepositoryToken(CollectionEntry),
                    useValue: mockRepository,
                },
                CollectionsEntriesService,
                {
                    provide: ActivitiesQueueService,
                    useValue: {
                        addActivity: async () => {},
                        deleteActivity: async () => {},
                    },
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
        const createSpy = jest.spyOn(service, "replace");
        const repositorySaveSpy = jest.spyOn(repository, "save");
        await service.replace(userId, dto);
        expect(createSpy).toHaveReturned();
        expect(repositorySaveSpy).toBeCalledWith(
            expect.objectContaining({
                isFavorite: true,
            }),
        );
    });

    it("should attach a review when re-creating a entry", async () => {
        const userId = "1";
        const dto: CreateCollectionEntryDto = {
            isFavorite: true,
            gameId: 1942,
            collectionIds: ["111111"],
            platformIds: [EGamePlatformIds.PC.valueOf()],
        };
        const reviewFindSpy = jest.spyOn(
            reviewService,
            "findOneByUserIdAndGameId",
        );
        reviewFindSpy.mockImplementation(async () => {
            return { id: "review12345" } as Review;
        });
        jest.spyOn(repository, "save").mockImplementationOnce(async () => {
            return { id: "12345" } as CollectionEntry;
        });

        const createSpy = jest.spyOn(service, "replace");
        const repositorySaveSpy = jest.spyOn(repository, "save");
        await service.replace(userId, dto);
        expect(reviewFindSpy).toBeCalled();
        expect(createSpy).toHaveReturned();
        expect(repositorySaveSpy).toBeCalledWith(
            expect.objectContaining({
                review: {
                    id: "review12345",
                },
            }),
        );
    });
});
