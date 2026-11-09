import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BillingModule } from "../../billing/billing.module";
import { Profile } from "../entities/profile.entity";
import { ProfileAvatar } from "../entities/profile-avatar.entity";
import { ProfileBanner } from "../entities/profile-banner.entity";
import { ProfileVideo } from "../entities/profile-video.entity";
import { PROFILE_VIDEO_QUEUE_NAME } from "./profile-video.constants";
import { ProfileVideoController } from "./profile-video.controller";
import { ProfileVideoProcessor } from "./profile-video.processor";
import { ProfileVideoQueueService } from "./profile-video-queue.service";
import { ProfileVideoService } from "./profile-video.service";
import { ProfileVideoTempService } from "./profile-video-temp.service";
import { SupporterGuard } from "./supporter.guard";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Profile,
            ProfileAvatar,
            ProfileBanner,
            ProfileVideo,
        ]),
        BullModule.registerQueue({
            name: PROFILE_VIDEO_QUEUE_NAME,
            defaultJobOptions: {
                attempts: 1,
                removeOnComplete: true,
                removeOnFail: true,
            },
        }),
        BillingModule,
    ],
    controllers: [ProfileVideoController],
    providers: [
        ProfileVideoService,
        ProfileVideoQueueService,
        ProfileVideoProcessor,
        ProfileVideoTempService,
        SupporterGuard,
    ],
    exports: [ProfileVideoService],
})
export class ProfileVideoModule {}
