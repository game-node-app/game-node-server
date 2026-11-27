import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";
import Redis from "ioredis";
import { RedisHealthIndicator } from "@liaoliaots/nestjs-redis-health";
import { getRedisConfig } from "../utils/getRedisConfig";

@Injectable()
export class HealthService implements OnModuleDestroy {
    private readonly clients = new Map<"cache" | "bullmq", Redis>();

    constructor(
        private healthCheckService: HealthCheckService,
        private redisHealthCheck: RedisHealthIndicator,
        private typeOrmHealthCheck: TypeOrmHealthIndicator,
    ) {}

    private getRedisClient(target: "cache" | "bullmq" = "cache"): Redis {
        let client = this.clients.get(target);
        if (!client) {
            const { host, port } = getRedisConfig(target);
            client = new Redis({ host, port, maxRetriesPerRequest: 1 });
            this.clients.set(target, client);
        }
        return client;
    }

    private checkRedisHealth(target: "cache" | "bullmq" = "cache") {
        const key = target === "bullmq" ? "bullmq-redis" : "redis";
        return this.redisHealthCheck.checkHealth(key, {
            type: "redis",
            client: this.getRedisClient(target),
        });
    }

    private checkTypeOrmHealth() {
        return this.typeOrmHealthCheck.pingCheck("typeorm");
    }

    async checkHealth() {
        return this.healthCheckService.check([
            () => this.checkRedisHealth("cache"),
            () => this.checkRedisHealth("bullmq"),
            () => this.checkTypeOrmHealth(),
        ]);
    }

    async onModuleDestroy() {
        for (const client of this.clients.values()) {
            client.disconnect();
        }
        this.clients.clear();
    }
}
