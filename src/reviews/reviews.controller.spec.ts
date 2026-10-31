import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthGuard } from "../auth/auth.guard";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";
import { Review } from "./entities/review.entity";

it("a second POST /v1/reviews updates the same review and keeps omitted content", async () => {
    let row: Review | null = null;
    const repository = {
        findOne: jest.fn(async () => row),
        merge: (review: Review, input: object) =>
            Object.assign(
                review,
                Object.fromEntries(
                    Object.entries(input).filter(
                        ([, value]) => value !== undefined,
                    ),
                ),
            ),
        update: jest.fn(async (_id, review) => {
            row = review;
        }),
        create: (review: object) => review,
        manager: {
            transaction: async (
                action: (manager: object) => Promise<unknown>,
            ) =>
                action({
                    queryRunner: { isTransactionActive: true },
                    connection: { options: {} },
                    query: async () => ({ insertId: 1 }),
                    getRepository: () => ({
                        save: async (review: Review) => {
                            row = { ...review, id: "review" };
                            return row;
                        },
                    }),
                }),
        },
    };
    const activity = { register: jest.fn() };
    const service = new ReviewsService(
        repository as any,
        activity as any,
        {
            findOneByUserIdAndGameIdOrFail: async () => ({ id: "entry" }),
        } as any,
        { addTrackingJob: jest.fn() } as any,
        { registerLevelExpIncreaseActivity: jest.fn() } as any,
    );
    const module = await Test.createTestingModule({
        controllers: [ReviewsController],
        providers: [{ provide: ReviewsService, useValue: service }],
    })
        .overrideGuard(AuthGuard)
        .useValue({
            canActivate: (context: any) => {
                context.switchToHttp().getRequest().session = {
                    getUserId: () => "user",
                };
                return true;
            },
        })
        .compile();
    const app: INestApplication = module.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    try {
        await app.init();
        await request(app.getHttpServer())
            .post("/v1/reviews")
            .send({ gameId: 1, rating: 3, content: "<p>Keep me</p>" })
            .expect(201);
        await request(app.getHttpServer())
            .post("/v1/reviews")
            .send({ gameId: 1, rating: 5 })
            .expect(201);
        expect(row).toMatchObject({
            id: "review",
            rating: 5,
            content: "<p>Keep me</p>",
        });
        expect(repository.update).toHaveBeenCalledWith(
            "review",
            expect.objectContaining({ rating: 5 }),
        );
        expect(activity.register).toHaveBeenCalledTimes(1);
    } finally {
        await app.close();
    }
});
