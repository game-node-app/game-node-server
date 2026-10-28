import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AuthGuard } from "../auth/auth.guard";
import { ImporterController } from "./importer.controller";
import { ImporterService } from "./importer.service";
import { ImporterBatchImportService } from "./importer-batch-import.service";

describe("empty discovery HTTP compatibility", () => {
    let app: INestApplication;
    const findUnprocessedEntries = jest.fn();
    const changeStatusBatch = jest.fn();
    const changeStatus = jest.fn();
    const importBatch = jest
        .fn()
        .mockResolvedValue({ importedCount: 0, skippedCount: 0 });
    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [ImporterController],
            providers: [
                {
                    provide: ImporterService,
                    useValue: {
                        findUnprocessedEntries,
                        changeStatusBatch,
                        changeStatus,
                    },
                },
                {
                    provide: ImporterBatchImportService,
                    useValue: { import: importBatch },
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
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
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
    it("keeps the library filter when checking whether an empty search has candidates", async () => {
        findUnprocessedEntries.mockResolvedValue([[], 0]);
        await request(app.getHttpServer())
            .get("/importer/steam?search=missing&excludeInLibrary=true")
            .expect(404);
        expect(findUnprocessedEntries.mock.calls[1][2].excludeInLibrary).toBe(
            true,
        );
    });
    it.each(["", "?excludeInLibrary=false"])(
        "preserves the listing with %s",
        async (query) => {
            findUnprocessedEntries.mockResolvedValue([[{ id: 1 }], 1]);
            await request(app.getHttpServer())
                .get(`/importer/steam${query}`)
                .expect(200);
            expect(
                findUnprocessedEntries.mock.calls[0][2].excludeInLibrary,
            ).toBe(query ? false : undefined);
            findUnprocessedEntries.mockResolvedValue([[], 0]);
            await request(app.getHttpServer())
                .get(`/importer/steam${query}`)
                .expect(404);
        },
    );
    it("rejects invalid boolean filters", async () => {
        await request(app.getHttpServer())
            .get("/importer/steam?excludeInLibrary=invalid")
            .expect(400);
    });
    it("validates batch status input and forwards valid requests", async () => {
        for (const body of [
            { source: "unknown", externalGameIds: [1], status: "ignored" },
            { source: "steam", externalGameIds: [], status: "ignored" },
            { source: "steam", externalGameIds: [0], status: "ignored" },
            { source: "steam", externalGameIds: [1], status: "invalid" },
        ])
            await request(app.getHttpServer())
                .post("/importer/status/batch")
                .send(body)
                .expect(400);
        await request(app.getHttpServer())
            .post("/importer/status/batch")
            .send({ source: "steam", externalGameIds: [1], status: "ignored" })
            .expect(201);
        expect(changeStatusBatch).toHaveBeenCalledWith(
            "owner",
            expect.objectContaining({
                source: "steam",
                externalGameIds: [1],
                status: "ignored",
            }),
        );
    });
    it("keeps the existing individual status contract", async () => {
        await request(app.getHttpServer())
            .post("/importer/status")
            .send({ externalGameId: 1, status: "ignored" })
            .expect(201);
        expect(changeStatus).toHaveBeenCalledWith(
            "owner",
            expect.objectContaining({ externalGameId: 1, status: "ignored" }),
        );
    });
    it("validates batch import requests and forwards a valid selection", async () => {
        for (const body of [
            {},
            { externalGameIds: [] },
            { externalGameIds: [1], importAll: true },
            { externalGameIds: [-1] },
            { externalGameIds: [1], status: "invalid" },
        ])
            await request(app.getHttpServer())
                .post("/importer/steam/import")
                .send(body)
                .expect(400);
        await request(app.getHttpServer())
            .post("/importer/unknown/import")
            .send({ importAll: true })
            .expect(400);
        await request(app.getHttpServer())
            .post("/importer/steam/import")
            .send({ externalGameIds: [1] })
            .expect(201);
        expect(importBatch).toHaveBeenCalledWith(
            "owner",
            "steam",
            expect.objectContaining({ externalGameIds: [1] }),
        );
    });
});
