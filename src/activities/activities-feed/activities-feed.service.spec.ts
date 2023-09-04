import { Test, TestingModule } from "@nestjs/testing";
import { ActivitiesFeedService } from "./activities-feed.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Activity } from "../entities/activity.entity";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { Profile } from "../../profile/entities/profile.entity";

export const mockActivities: Activity[] = [
    {
        id: "test",
        type: ActivityType.REVIEW,
        sourceId: "test",
        profile: {} as Profile,
        statistics: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

describe("ActivitiesFeedService", () => {
    let service: ActivitiesFeedService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ActivitiesFeedService,
                { provide: getRepositoryToken(Activity) ,useValue:},
            ],
        }).compile();

        service = module.get<ActivitiesFeedService>(ActivitiesFeedService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should return an activites feed", () => {});
});
