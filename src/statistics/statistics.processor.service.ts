import { Processor, Process } from "@nestjs/bull";
import { Job } from "bull";
import { InjectRepository } from "@nestjs/typeorm";

@Processor("statistics")
export class StatisticsProcessorService {
    constructor() {}

    @Process("registerGameView")
    async handleRegisterGameView(job: Job) {}
}
