import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { TerminusModule } from "@nestjs/terminus";
import { RedisHealthModule } from "@liaoliaots/nestjs-redis-health";

@Module({
    imports: [TerminusModule, RedisHealthModule],
    controllers: [HealthController],
    providers: [HealthService],
})
export class HealthModule {}
