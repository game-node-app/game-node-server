import { HealthService } from "./health.service";

const mockInstances: Array<{ disconnect: jest.Mock; options: unknown }> = [];

jest.mock("ioredis", () => ({
    __esModule: true,
    default: jest.fn().mockImplementation((options: unknown) => {
        const instance = { disconnect: jest.fn(), options };
        mockInstances.push(instance);
        return instance;
    }),
}));

describe("HealthService", () => {
    const originalRedisUrl = process.env.REDIS_URL;
    const originalBullmqUrl = process.env.BULLMQ_REDIS_URL;

    beforeEach(() => {
        mockInstances.length = 0;
        process.env.REDIS_URL = "redis://server-redis:6379";
        process.env.BULLMQ_REDIS_URL = "redis://server-redis-bullmq:6379";
    });

    afterEach(() => {
        process.env.REDIS_URL = originalRedisUrl;
        process.env.BULLMQ_REDIS_URL = originalBullmqUrl;
    });

    it("reuses one Redis client per target across health checks and disconnects on shutdown", async () => {
        const checkHealth = jest.fn().mockResolvedValue({ status: "up" });
        const pingCheck = jest.fn().mockResolvedValue({ typeorm: { status: "up" } });
        const healthCheckService = {
            check: jest.fn(async (indicators: Array<() => Promise<unknown>>) => {
                for (const fn of indicators) await fn();
                return { status: "ok" };
            }),
        };

        const service = new HealthService(
            healthCheckService as never,
            { checkHealth } as never,
            { pingCheck } as never,
        );

        await service.checkHealth();
        await service.checkHealth();
        await service.checkHealth();

        expect(mockInstances).toHaveLength(2);
        expect(checkHealth).toHaveBeenCalledTimes(6);

        await service.onModuleDestroy();
        expect(mockInstances[0].disconnect).toHaveBeenCalledTimes(1);
        expect(mockInstances[1].disconnect).toHaveBeenCalledTimes(1);
    });
});
