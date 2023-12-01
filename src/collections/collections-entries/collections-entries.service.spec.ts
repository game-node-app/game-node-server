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

describe("CollectionsEntriesService", () => {
    let service: CollectionsEntriesService;
    let repository: Repository<CollectionEntry>;
    let reviewService: ReviewsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: getRepositoryToken(CollectionEntry),
                    useValue: {
                        findOne: jest.fn(),
                        save: jest.fn(),
                    },
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
                    },
                },
            ],
        }).compile();

        service = module.get<CollectionsEntriesService>(
            CollectionsEntriesService,
        );
        reviewService = module.get(ReviewsService);
        repository = module.get(getRepositoryToken(CollectionEntry));
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
            platformIds: [
                EGamePlatformIds.PC.valueOf(),
            ],
        };
        jest.spyOn(
            reviewService,
            "findOneByUserIdAndGameId",
        ).mockImplementation((userId, gameId) => {
            return Promise.resolve({} as Review);
        });
        jest.spyOn(repository, "save").mockImplementationOnce(async () => {
            return { id: "12345" } as CollectionEntry;
        });
        const createSpy = jest.spyOn(service, "createOrUpdate");
        const repositorySaveSpy = jest.spyOn(repository, "save");
        await service.createOrUpdate(userId, dto);
        expect(createSpy).toBeCalled();
        expect(repositorySaveSpy).toBeCalledWith({
            ...dto,
            collections: [{id: "111111"}],
            game: {
                id: dto.gameId,
            },
            ownedPlatforms: [
                {
                    id: EGamePlatformIds.PC.valueOf(),
                }
            ],
            review: {
                id: undefined,
            },
        });
    });
});
