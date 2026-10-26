import {
    ExecutionContext,
    INestApplication,
    UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { CacheModule } from "@nestjs/cache-manager";
import request from "supertest";
import { StatisticsController } from "./statistics.controller";
import { StatisticsService } from "./statistics.service";
import { StatisticsTrendingService } from "./statistics-trending.service";
import { AuthGuard } from "../auth/auth.guard";
import { SuspensionGuard } from "../suspension/suspension.guard";

describe("reaction write guards", () => {
    let app: INestApplication;
    let authenticated: boolean;
    let suspended: boolean;
    const applyReaction = jest.fn();
    const body = {
        sourceType: "post",
        sourceId: "123e4567-e89b-42d3-a456-426614174000",
    };

    beforeEach(async () => {
        authenticated = true;
        suspended = false;
        applyReaction
            .mockReset()
            .mockResolvedValue({ isLiked: true, likesCount: 1 });
        const module = await Test.createTestingModule({
            imports: [
                ThrottlerModule.forRoot([{ ttl: 60000, limit: 1 }]),
                CacheModule.register(),
            ],
            controllers: [StatisticsController],
            providers: [
                { provide: StatisticsService, useValue: { applyReaction } },
                { provide: StatisticsTrendingService, useValue: {} },
            ],
        })
            .overrideGuard(AuthGuard)
            .useValue({
                canActivate(context: ExecutionContext) {
                    if (!authenticated) throw new UnauthorizedException();
                    context.switchToHttp().getRequest().session = {
                        getUserId: () => "session-actor",
                    };
                    return true;
                },
            })
            .overrideGuard(SuspensionGuard)
            .useValue({ canActivate: () => !suspended })
            .compile();
        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app?.close();
    });

    it.each(["put", "delete"] as const)(
        "throttles %s before another reaction reaches persistence",
        async (method) => {
            await request(app.getHttpServer())
                [method]("/statistics/like")
                .send(body)
                .expect(200);
            await request(app.getHttpServer())
                [method]("/statistics/like")
                .send(body)
                .expect(429);
            expect(applyReaction).toHaveBeenCalledTimes(1);
            expect(applyReaction).toHaveBeenCalledWith(
                "session-actor",
                body,
                method === "put",
            );
        },
    );

    it("rejects unauthenticated and suspended actors before persistence", async () => {
        authenticated = false;
        await request(app.getHttpServer())
            .put("/statistics/like")
            .send(body)
            .expect(401);
        authenticated = true;
        suspended = true;
        await request(app.getHttpServer())
            .put("/statistics/like")
            .send(body)
            .expect(403);
        expect(applyReaction).not.toHaveBeenCalled();
    });

    it.each([
        { sourceType: "post", sourceId: "invalid" },
        { sourceType: "unsupported", sourceId: 1 },
        { ...body, targetUserId: "forged" },
        ...[-1, true, {}, "1e2", "0x10", Number.MAX_SAFE_INTEGER + 1].map(
            (sourceId) => ({ sourceType: "game", sourceId }),
        ),
    ])(
        "rejects forged properties and invalid source identities before persistence: %j",
        async (input) => {
            await request(app.getHttpServer())
                .put("/statistics/like")
                .send(input)
                .expect(400);
            expect(applyReaction).not.toHaveBeenCalled();
        },
    );
});
