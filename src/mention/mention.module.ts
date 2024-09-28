import { Module } from "@nestjs/common";
import { MentionService } from "./mention.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewMention } from "./entity/review-mention.entity";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
    imports: [TypeOrmModule.forFeature([ReviewMention]), NotificationsModule],
    providers: [MentionService],
    exports: [MentionService],
})
export class MentionModule {}
