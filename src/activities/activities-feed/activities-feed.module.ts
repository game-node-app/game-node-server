import { Module } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ActivitiesFeedController } from "./activities-feed.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Activity } from "../activities-repository/entities/activity.entity";
import { FollowModule } from "../../follow/follow.module";
import { ActivitiesRepositoryModule } from "../activities-repository/activities-repository.module";

@Module({
    imports: [
        ActivitiesRepositoryModule,
        FollowModule,
        TypeOrmModule.forFeature([Activity]),
    ],
    controllers: [ActivitiesFeedController],
    providers: [ActivitiesFeedService],
})
export class ActivitiesFeedModule {}
