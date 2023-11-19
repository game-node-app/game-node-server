import { Test, TestingModule } from "@nestjs/testing";
import { ActivitiesFeedService } from "./activities-feed.service";
import { Activity } from "../activities-repository/entities/activity.entity";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { Profile } from "../../profile/entities/profile.entity";

export const mockActivities: Activity[] = [
    {
        id: "test",
        type: ActivityType.REVIEW,
        sourceId: "test",
        profile: {} as Profile,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

describe("ActivitiesFeedService", () => {
    let service: ActivitiesFeedService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [ActivitiesFeedService],
        }).compile();

        service = module.get<ActivitiesFeedService>(ActivitiesFeedService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("should return an activites feed", () => {});
});
