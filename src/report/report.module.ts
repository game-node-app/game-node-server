import { Module } from "@nestjs/common";
import { ReportService } from "./report.service";
import { ReportController } from "./report.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Report } from "./entity/report.entity";
import { ReviewsModule } from "../reviews/reviews.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SuspensionModule } from "../suspension/suspension.module";
import { CommentModule } from "../comment/comment.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Report]),
        ReviewsModule,
        NotificationsModule,
        SuspensionModule,
        CommentModule,
    ],
    providers: [ReportService],
    controllers: [ReportController],
})
export class ReportModule {}
