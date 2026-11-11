import { Module } from "@nestjs/common";
import { ProfileService } from "./profile.service";
import { ProfileController } from "./profile.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Profile } from "./entities/profile.entity";
import { ProfileAvatar } from "./entities/profile-avatar.entity";
import { ProfileBanner } from "./entities/profile-banner.entity";
import { ProfileVideo } from "./entities/profile-video.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { ProfileVideoModule } from "./profile-video/profile-video.module";
import { SupporterPreferencesModule } from "./supporter-preferences/supporter-preferences.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Profile,
            ProfileAvatar,
            ProfileBanner,
            ProfileVideo,
        ]),
        NotificationsModule,
        ProfileVideoModule,
        SupporterPreferencesModule,
    ],
    controllers: [ProfileController],
    providers: [ProfileService],
    exports: [ProfileService],
})
export class ProfileModule {}
