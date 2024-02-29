import { Test, TestingModule } from "@nestjs/testing";
import { HealthService } from "./health.service";
import { HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";
import { RedisHealthIndicator } from "@liaoliaots/nestjs-redis-health";

describe("HealthService", () => {
    let service: HealthService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HealthService,
                {
                    provide: HealthCheckService,
                    useValue: {
                        check: jest.fn(),
                    },
                },
                {
                    provide: RedisHealthIndicator,
                    useValue: {},
                },
                {
                    provide: TypeOrmHealthIndicator,
                    useValue: {},
                },
            ],
        }).compile();

        service = module.get<HealthService>(HealthService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });
});
