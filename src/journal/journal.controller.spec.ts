import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { JournalController } from "./journal.controller";
import { JournalService } from "./journal.service";
import { JournalPlayLogService } from "./journal-play-log.service";
import { JournalHeatmapService } from "./journal-heatmap.service";
import { JournalAchievementsService } from "./journal-achievements.service";
import { AuthService } from "../auth/auth.service";

describe("JournalController", () => {
    let app: INestApplication;
    let journalService: { getOverview: jest.Mock };
    let getSession: jest.Mock;

    beforeEach(async () => {
        journalService = {
            getOverview: jest.fn().mockResolvedValue({ years: [] }),
        };
        getSession = jest.fn(async () => null);
        const module: TestingModule = await Test.createTestingModule({
            controllers: [JournalController],
            providers: [
                { provide: AuthService, useValue: { getSession } },
                { provide: JournalService, useValue: journalService },
                { provide: JournalPlayLogService, useValue: {} },
                { provide: JournalHeatmapService, useValue: {} },
                { provide: JournalAchievementsService, useValue: {} },
            ],
        }).compile();

        app = module.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it("serves every year when the year parameter is omitted", async () => {
        await request(app.getHttpServer())
            .get("/journal/overview/owner")
            .expect(200);

        expect(journalService.getOverview).toHaveBeenCalledWith(
            undefined,
            "owner",
            undefined,
        );
    });

    it("passes a valid year filter through for a signed-in viewer", async () => {
        getSession.mockResolvedValue({ user: { id: "user", role: "user" } });

        await request(app.getHttpServer())
            .get("/journal/overview/owner?year=2026")
            .expect(200);

        expect(journalService.getOverview).toHaveBeenCalledWith(
            "user",
            "owner",
            2026,
        );
    });

    it.each(["abc", "1800", "2101", "2026.5", ""])(
        "rejects year=%p with 400",
        async (year) => {
            await request(app.getHttpServer())
                .get(`/journal/overview/owner?year=${year}`)
                .expect(400);

            expect(journalService.getOverview).not.toHaveBeenCalled();
        },
    );
});
