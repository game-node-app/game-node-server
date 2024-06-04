import { Module } from "@nestjs/common";
import { ReportService } from "./report.service";
import { ReportController } from "./report.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Report } from "./entity/report.entity";

@Module({
    imports: [TypeOrmModule.forFeature([Report])],
    providers: [ReportService],
    controllers: [ReportController],
})
export class ReportModule {}
