import { Module } from "@nestjs/common";
import { FollowService } from "./follow.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserFollow } from "./entity/user-follow.entity";
import { FollowController } from "./follow.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { ActivitiesQueueModule } from "../activities/activities-queue/activities-queue.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([UserFollow]),
        NotificationsModule,
        ActivitiesQueueModule,
    ],
    providers: [FollowService],
    controllers: [FollowController],
    exports: [FollowService],
})
export class FollowModule {}
