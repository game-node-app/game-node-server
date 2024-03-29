import { Injectable } from "@nestjs/common";
import { HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";
import * as process from "process";
import Redis from "ioredis";
import { RedisHealthIndicator } from "@liaoliaots/nestjs-redis-health";
import { RabbitMQHealthCheckService } from "./checks/rabbitmq-health-check.service";

@Injectable()
export class HealthService {
    constructor(
        private healthCheckService: HealthCheckService,
        private redisHealthCheck: RedisHealthIndicator,
        private typeOrmHealthCheck: TypeOrmHealthIndicator,
        private rabbitMqHealthCheck: RabbitMQHealthCheckService,
    ) {}

    private buildRedisInstance() {
        const redisUrl = process.env.REDIS_URL;
        const redisHost = new URL(redisUrl!).hostname;
        const redisPortString = new URL(redisUrl!).port;

        return new Redis({
            host: redisHost,
            port: parseInt(redisPortString),
        });
    }

    private checkRedisHealth() {
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
            () => this.checkTypeOrmHealth(),
            () => this.rabbitMqHealthCheck.check(),
        ]);
    }
}
