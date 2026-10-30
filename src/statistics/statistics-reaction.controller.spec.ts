import {
    ExecutionContext,
    INestApplication,
    UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { CacheModule } from "@nestjs/cache-manager";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import request from "supertest";
import { StatisticsController } from "./statistics.controller";
import { StatisticsService } from "./statistics.service";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { AuthGuard } from "../auth/auth.guard";
import { SuspensionGuard } from "../suspension/suspension.guard";

describe("reaction write guards", () => {
    let app: INestApplication;
    let authenticated: boolean;
    let suspended: boolean;
    const applyReaction = jest.fn();
    const statisticsService = {
        applyReaction,
        findSummary: jest.fn(),
        getStatus: jest.fn(),
        findSeries: jest.fn(),
        recordView: jest.fn(),
    };
    const findRankings = jest.fn();
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
        statisticsService.findSummary.mockReset();
        statisticsService.getStatus.mockReset();
        statisticsService.findSeries.mockReset();
        statisticsService.recordView.mockReset().mockResolvedValue({ accepted: true, viewId: body.sourceId });
        findRankings.mockReset();
        const module = await Test.createTestingModule({
            imports: [
                ThrottlerModule.forRoot([{ ttl: 60000, limit: 2 }]),
                CacheModule.register(),
            ],
            controllers: [StatisticsController],
            providers: [
                { provide: StatisticsService, useValue: statisticsService },
                { provide: StatisticsRankingService, useValue: { findRankings } },
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
                .expect(200);
            await request(app.getHttpServer())
                [method]("/statistics/like")
                .send(body)
                .expect(429);
            expect(applyReaction).toHaveBeenCalledTimes(2);
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
        await request(app.getHttpServer())
            .post("/statistics/view")
            .send({ ...body, viewId: body.sourceId })
            .expect(403);
        expect(statisticsService.recordView).not.toHaveBeenCalled();
    });

    it("documents the source API and preserves the reaction paths", () => {
        const document = SwaggerModule.createDocument(
            app,
            new DocumentBuilder().setTitle("GameNode API").setVersion("1.0").build(),
        );
        for (const [path, method, status] of [
            ["/statistics", "post", "200"],
            ["/statistics/status", "get", "200"],
            ["/statistics/series", "post", "200"],
            ["/statistics/rankings", "post", "200"],
            ["/statistics/view", "post", "202"],
            ["/statistics/like", "put", "200"],
            ["/statistics/like", "delete", "200"],
        ] as const) {
            expect(document.paths[path]?.[method]?.responses?.[status]).toBeDefined();
        }
        const schemas = document.components?.schemas as Record<string, any>;
        expect(schemas.ReactionRequestDto.properties.sourceId.oneOf).toEqual([
            { type: "string", format: "uuid" }, { type: "integer", minimum: 1 },
        ]);
        expect(schemas.StatisticsRankingsRequestDto.properties.limit.type).toBe("number");
        expect(schemas.StatisticsRankingsRequestDto.properties.offset.type).toBe("number");
        expect(schemas.StatisticsViewResponseDto.properties.viewId.format).toBe("uuid");
        expect(schemas.StatisticsSeriesDto.properties.completeSince.nullable).toBe(true);
        expect(schemas.StatisticsRankingResponseDto.properties.definitionVersion.type).toBe("string");
        expect(schemas.StatisticsSourceRequestDto.properties.sourceType.enum).toEqual([
            "game", "review", "activity", "post", "review_comment", "activity_comment", "post_comment",
        ]);
        expect(schemas.StatisticsRankingResponseDto.properties.pagination.$ref).toContain("StatisticsRankingPaginationDto");
    });

    it("acknowledges a retry-stable view only with the strict source DTO", async () => {
        const viewId = "123e4567-e89b-42d3-a456-426614174000";
        await request(app.getHttpServer())
            .post("/statistics/view")
            .send({ ...body, viewId })
            .expect(202)
            .expect({ accepted: true, viewId });
        expect(statisticsService.recordView).toHaveBeenCalledWith("session-actor", { ...body, viewId });

        await request(app.getHttpServer())
            .post("/statistics/view")
            .send({ ...body, viewId, targetUserId: "forged" })
            .expect(400);
        expect(statisticsService.recordView).toHaveBeenCalledTimes(1);
    });

    it("rejects obsolete routes and raw ranking inputs", async () => {
        for (const route of ["trending/games", "trending/reviews", "queue/view", "queue/like"])
            await request(app.getHttpServer()).post(`/statistics/${route}`).send(body).expect(404);
        await request(app.getHttpServer()).get("/statistics/status").query({ statisticsId: 1 }).expect(400);
        for (const extra of [{ formula: "views * 100" }, { limit: 101 }, { offset: -1 }, { criteria: { orderBy: "score DESC" } }])
            await request(app.getHttpServer()).post("/statistics/rankings").send({ sourceType: "game", ...extra }).expect(400);
        expect(findRankings).not.toHaveBeenCalled();
        await request(app.getHttpServer()).post("/statistics/rankings").send({ sourceType: "game" }).expect(200);
        expect(findRankings).toHaveBeenCalledWith("session-actor", expect.objectContaining({ mode: "popular" }));
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
