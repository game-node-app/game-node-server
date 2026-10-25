import { Test } from "@nestjs/testing";
import {
    ExecutionContext,
    INestApplication,
    ValidationPipe,
} from "@nestjs/common";
import request from "supertest";
import { PlaytimeController } from "./playtime.controller";
import { PlaytimeService } from "./playtime.service";
import { AuthGuard } from "../auth/auth.guard";

describe("manual playtime HTTP boundary", () => {
    let app: INestApplication;
    let authenticated = true;
    const submit = jest.fn();
    const valid = {
        gameId: 1,
        platformId: 6,
        source: "steam",
        totalPlaytimeSeconds: 120,
    };
    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [PlaytimeController],
            providers: [{ provide: PlaytimeService, useValue: { submit } }],
        })
            .overrideGuard(AuthGuard)
            .useValue({
                canActivate(context: ExecutionContext) {
                    context.switchToHttp().getRequest().session = {
                        getUserId: () => "owner",
                    };
                    return authenticated;
                },
            })
            .compile();
        app = module.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
    });
    beforeEach(() => {
        authenticated = true;
        submit.mockClear();
    });
    afterAll(async () => app.close());

    it.each([
        { gameId: -1 },
        { gameId: 1.5 },
        { gameId: Number.MAX_SAFE_INTEGER + 1 },
        { platformId: 0 },
        { source: "invalid" },
        { totalPlaytimeSeconds: -1 },
        { totalPlaytimeSeconds: 1.5 },
        { totalPlaytimeSeconds: 2147483648 },
        { lastPlayedDate: "not-a-date" },
        { gameId: null },
        { source: null },
    ])("rejects invalid input %j before persistence", async (invalid) => {
        await request(app.getHttpServer())
            .post("/playtime")
            .send({ ...valid, ...invalid })
            .expect(400);
        expect(submit).not.toHaveBeenCalled();
    });
    it.each([undefined, null, "2026-10-25T12:00:00.000Z"])(
        "accepts played date %s using the session identity",
        async (date) => {
            await request(app.getHttpServer())
                .post("/playtime")
                .send({
                    ...valid,
                    lastPlayedDate: date,
                    profileUserId: "other",
                })
                .expect(201);
            expect(submit).toHaveBeenCalledWith(
                "owner",
                expect.objectContaining({
                    ...valid,
                    ...(date === undefined
                        ? {}
                        : {
                              lastPlayedDate:
                                  date === null ? null : new Date(date),
                          }),
                }),
            );
        },
    );
    it("requires authentication", async () => {
        authenticated = false;
        await request(app.getHttpServer())
            .post("/playtime")
            .send(valid)
            .expect(403);
        expect(submit).not.toHaveBeenCalled();
    });
});
