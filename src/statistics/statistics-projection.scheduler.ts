import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { STATISTICS_PROJECTION_QUEUE } from "./statistics-projection.constants";

@Injectable()
export class StatisticsProjectionScheduler implements OnModuleInit {
    private readonly logger = new Logger(StatisticsProjectionScheduler.name);

    constructor(
        @InjectQueue(STATISTICS_PROJECTION_QUEUE)
        private readonly queue: Queue,
    ) {}

    async onModuleInit(): Promise<void> {
        try {
            await this.queue.add(
                "drain",
                {},
                {
                    repeat: { every: 5000 },
                    attempts: 1,
                    removeOnComplete: { count: 100 },
                    removeOnFail: { count: 100 },
                },
            );
        } catch (error) {
            this.logger.error("Unable to arm statistics projection tick");
            throw error;
        }
    }
}
