import { INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Queue } from "bullmq";
import { IgdbSyncService } from "./igdb-sync.service";
import { IgdbSyncController } from "./igdb-sync.controller";
import { JwtAuthGuard } from "../../auth/jwt-auth/jwt-auth.guard";
import { catalogConfig } from "./catalog/igdb-catalog.config";

describe("authenticated legacy ingestion modes", () => {
    let app: INestApplication;
    const addBulk = jest.fn().mockResolvedValue([]);
    const config = catalogConfig({});
    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [IgdbSyncController],
            providers: [
                {
                    provide: IgdbSyncService,
                    useValue: new IgdbSyncService(
                        { addBulk } as unknown as Queue,
                        config,
                    ),
                },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({
                canActivate: (context: any) => {
                    if (
                        context.switchToHttp().getRequest().headers
                            .authorization !== "Bearer fixture"
                    )
                        throw new UnauthorizedException();
                    return true;
                },
            })
            .compile();
        app = module.createNestApplication();
        app.setGlobalPrefix("v1");
        await app.init();
    });
    afterAll(async () => {
        await app.close();
    });
    beforeEach(() => {
        addBulk.mockClear();
        config.enabled = false;
    });
    it("keeps JWT authentication required", async () => {
        await request(app.getHttpServer())
            .post("/v1/sync/igdb")
            .send([])
            .expect(401);
        expect(addBulk).not.toHaveBeenCalled();
    });
    it("rejects authenticated internal-mode pushes with 409 before queueing", async () => {
        config.enabled = true;
        await request(app.getHttpServer())
            .post("/v1/sync/igdb")
            .set("Authorization", "Bearer fixture")
            .send([{ id: 1 }])
            .expect(409);
        expect(addBulk).not.toHaveBeenCalled();
    });
    it("preserves disabled-mode ingestion", async () => {
        await request(app.getHttpServer())
            .post("/v1/sync/igdb")
            .set("Authorization", "Bearer fixture")
            .send([{ id: 1, name: "Fixture", slug: "fixture", updated_at: 1 }])
            .expect(204);
        expect(addBulk).toHaveBeenCalledTimes(1);
    });
});
