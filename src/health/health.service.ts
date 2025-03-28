import { Injectable } from "@nestjs/common";
import { HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";
import * as process from "process";
import Redis from "ioredis";
import { RedisHealthIndicator } from "@liaoliaots/nestjs-redis-health";

@Injectable()
export class HealthService {
    constructor(
        private healthCheckService: HealthCheckService,
        private redisHealthCheck: RedisHealthIndicator,
        private typeOrmHealthCheck: TypeOrmHealthIndicator,
    ) {}

    private buildRedisInstance(target: "cache" | "bullmq" = "cache") {
        let redisUrl = process.env.REDIS_URL;

        if (target === "bullmq") {
            redisUrl = process.env.BULLMQ_REDIS_URL;
        }

        const redisHost = new URL(redisUrl!).hostname;
        const redisPortString = new URL(redisUrl!).port;

        return new Redis({
            host: redisHost,
            port: parseInt(redisPortString),
        });
    }

    private checkRedisHealth(target: "cache" | "bullmq" = "cache") {
        if (target === "bullmq") {
            return this.redisHealthCheck.checkHealth("bullmq-redis", {
                type: "redis",
                client: this.buildRedisInstance("bullmq"),
            });
        }

        return this.redisHealthCheck.checkHealth("redis", {
            type: "redis",
            client: this.buildRedisInstance(),
        });
    }

    private checkTypeOrmHealth() {
        return this.typeOrmHealthCheck.pingCheck("typeorm");
    }

    async checkHealth() {
        return this.healthCheckService.check([
            () => this.checkRedisHealth(),
            () => this.checkRedisHealth("bullmq"),
            () => this.checkTypeOrmHealth(),
        ]);
    }
}
