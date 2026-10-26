import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsService } from "./notifications.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { Profile } from "../profile/entities/profile.entity";
import { DataSource, Repository } from "typeorm";
import Mocked = jest.Mocked;
import { Logger } from "@nestjs/common";

describe("NotificationsService", () => {
    let service: NotificationsService;
    let inboxRepo: Mocked<Repository<NotificationInbox>>;
    let profileRepo: Mocked<Repository<Profile>>;
    let dataSource: Mocked<DataSource>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                NotificationsService,
                {
                    provide: getRepositoryToken(NotificationInbox),
                    useValue: {
                        createQueryBuilder: jest.fn(),
                        find: jest.fn(),
                        update: jest.fn(),
                    },
                },
                {
                    provide: getRepositoryToken(Profile),
                    useValue: {
                        find: jest.fn(),
                    },
                },
                {
                    provide: DataSource,
                    useValue: {
                        query: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<NotificationsService>(NotificationsService);
        inboxRepo = module.get(getRepositoryToken(NotificationInbox));
        profileRepo = module.get(getRepositoryToken(Profile));
        dataSource = module.get(DataSource);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("returns paginated data with unread count", async () => {
        const debug = jest
            .spyOn(Logger.prototype, "debug")
            .mockImplementation(() => undefined);
        const mockQb: any = {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            addOrderBy: jest.fn().mockReturnThis(),
            take: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    recipientUserId: "recipient-1",
                    type: "content.liked",
                    actorIds: ["u1"],
                    eventCount: 1,
                    actorCount: 1,
                    lastEventAt: new Date(),
                    version: 1,
                    readVersion: 0,
                    preview: { text: "Liked your post" },
                    target: { type: "post", id: "p1" },
                },
            ]),
            getCount: jest.fn().mockResolvedValue(1),
        };

        inboxRepo.createQueryBuilder.mockReturnValue(mockQb);
        dataSource.query.mockResolvedValue([{ id: 1 }]);
        profileRepo.find.mockResolvedValue([
            { userId: "u1", username: "user_one", avatar: null } as any,
        ]);

        const result = await service.findAll("recipient-1", { limit: 20 });
        expect(result.data).toHaveLength(1);
        expect(result.data[0].actors[0].username).toBe("user_one");
        expect(result.unreadCount).toBe(1);
        expect(debug).toHaveBeenCalledWith({
            event: "notification-inbox-read",
            durationMs: expect.any(Number),
            returnedCount: 1,
            scannedCount: 1,
            limit: 20,
        });
        expect(JSON.stringify(debug.mock.calls)).not.toContain("recipient-1");
        debug.mockRestore();
    });
});
