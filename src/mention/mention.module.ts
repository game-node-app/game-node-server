import { Module } from "@nestjs/common";
import { MentionService } from "./mention.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewMention } from "./entity/review-mention.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { CommentMention } from "./entity/comment-mention.entity";
import { UserComment } from "../comment/entity/user-comment.entity";
import { CommentModule } from "../comment/comment.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([ReviewMention, CommentMention]),
        NotificationsModule,
    ],
    providers: [MentionService],
    exports: [MentionService],
})
export class MentionModule {}
