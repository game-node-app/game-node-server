import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsService } from "./notifications.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Notification } from "./entity/notification.entity";
import { getMockRepositoryProvider } from "../../test/mocks/repositoryMocks";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Repository } from "typeorm";
import { Cache } from "cache-manager";
import { ENotificationCategory } from "./notifications.constants";
import Mocked = jest.Mocked;

describe("NotificationsService", () => {
    let service: NotificationsService;
    let repository: Mocked<Repository<Notification>>;
    let cacheManager: Mocked<Cache>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                NotificationsService,
                getMockRepositoryProvider(Notification),
                {
                    provide: CACHE_MANAGER,
                    useValue: {
                        get: jest.fn(),
                        set: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<NotificationsService>(NotificationsService);
        repository = module.get(getRepositoryToken(Notification));
        cacheManager = module.get(CACHE_MANAGER);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should stream latest messages", async () => {
        const mockUserId = "12345";
        const mockLastCheckedDate = new Date();
        mockLastCheckedDate.setDate(-30);
        cacheManager.get.mockResolvedValueOnce(
            mockLastCheckedDate.toISOString(),
        );
        const mockedNotifications = [{ id: 12345 } as Notification];
        repository.find.mockResolvedValueOnce(mockedNotifications);
        const newNotifications = await service.findNewNotifications(
            mockUserId,
            false,
        );
        expect(newNotifications.length).toEqual(mockedNotifications.length);
    });

    it("should find and aggregate similar notifications", async () => {
        const mockUserId = "12345";
        const mockReviewId = "a-review-123";
        const mockNotifications = [
            {
                id: 123,
                reviewId: mockReviewId,
                category: ENotificationCategory.LIKE,
            } as Notification,
            {
                id: 456,
                reviewId: mockReviewId,
                category: ENotificationCategory.LIKE,
            } as Notification,
            {
                id: 789,
                reviewId: "another-review-321",
                category: ENotificationCategory.LIKE,
            } as Notification,
        ];
        const mockLastCheckedDate = new Date();
        mockLastCheckedDate.setDate(-30);
        cacheManager.get.mockResolvedValueOnce(
            mockLastCheckedDate.toISOString(),
        );
        repository.findAndCount.mockResolvedValue([
            structuredClone(mockNotifications),
            mockNotifications.length,
        ]);

        const [aggregations, _] = await service.findAllAndAggregate(
            mockUserId,
            { offset: 0 },
        );
        console.log(aggregations);

        const firstAggregation = aggregations[0];
        expect(aggregations.length).toEqual(2);
        expect(firstAggregation.category).toBe(ENotificationCategory.LIKE);
        expect(firstAggregation.sourceId).toBe(mockReviewId);
        expect(firstAggregation.notifications.length).toBe(2);
    });
});
