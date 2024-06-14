import { Module } from "@nestjs/common";
import { ReportService } from "./report.service";
import { ReportController } from "./report.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Report } from "./entity/report.entity";
import { ReviewsModule } from "../reviews/reviews.module";

@Module({
    imports: [TypeOrmModule.forFeature([Report]), ReviewsModule],
    providers: [ReportService],
    controllers: [ReportController],
})
export class ReportModule {}
