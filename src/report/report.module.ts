import { Module } from "@nestjs/common";
import { ReportService } from "./report.service";
import { ReportController } from "./report.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Report } from "./entity/report.entity";
import { ReviewsModule } from "../reviews/reviews.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { CommentModule } from "../comment/comment.module";
import { PostsModule } from "../posts/posts.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Report]),
        ReviewsModule,
        NotificationsModule,
        CommentModule,
        PostsModule,
    ],
    providers: [ReportService],
    controllers: [ReportController],
})
export class ReportModule {}
