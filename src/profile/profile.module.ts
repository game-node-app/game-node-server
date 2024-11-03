import { Module } from "@nestjs/common";
import { ProfileService } from "./profile.service";
import { ProfileController } from "./profile.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Profile } from "./entities/profile.entity";
import { ProfileAvatar } from "./entities/profile-avatar.entity";
import { ProfileBanner } from "./entities/profile-banner.entity";
import { SuspensionModule } from "../suspension/suspension.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Profile, ProfileAvatar, ProfileBanner]),
        SuspensionModule,
    ],
    controllers: [ProfileController],
    providers: [ProfileService],
    exports: [ProfileService],
})
export class ProfileModule {}
