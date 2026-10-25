import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AuthGuard } from "../auth/auth.guard";
import { ImporterController } from "./importer.controller";
import { ImporterService } from "./importer.service";

describe("empty discovery HTTP compatibility", () => {
    let app: INestApplication;
    const findUnprocessedEntries = jest.fn();
    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [ImporterController],
            providers: [
                {
                    provide: ImporterService,
                    useValue: { findUnprocessedEntries },
                },
            ],
        })
            .overrideGuard(AuthGuard)
            .useValue({
                canActivate(context: any) {
                    context.switchToHttp().getRequest().session = {
                        getUserId: () => "owner",
                    };
                    return true;
                },
            })
            .compile();
        app = module.createNestApplication();
        await app.init();
    });
    afterAll(async () => app.close());
    beforeEach(() => findUnprocessedEntries.mockReset());
    it("returns the existing no-new-games 404 only at the controller boundary", async () => {
        findUnprocessedEntries.mockResolvedValue([[], 0]);
        const result = await request(app.getHttpServer())
            .get("/importer/steam")
            .expect(404);
        expect(result.body.message).toBe("No unprocessed entries found");
    });
    it("preserves a successful empty search on an otherwise nonempty library", async () => {
        findUnprocessedEntries
            .mockResolvedValueOnce([[], 0])
            .mockResolvedValueOnce([[{ id: 1 }], 1]);
        await request(app.getHttpServer())
            .get("/importer/steam?search=missing")
            .expect(200);
    });
});
