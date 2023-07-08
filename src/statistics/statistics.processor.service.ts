import { Processor, Process } from "@nestjs/bull";
import { StatisticsService } from "./statistics.service";
import { Job } from "bull";
import { InjectRepository } from "@nestjs/typeorm";

@Processor("statistics")
export class StatisticsProcessorService {
    constructor(private statisticsService: StatisticsService) {}

    @Process("registerGameView")
    async handleRegisterGameView(job: Job) {}
}
