import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { ProfileMetricsController } from "./profile-metrics.controller";
import { ProfileMetricsService } from "./profile-metrics.service";
import { ProfileMetricsDistributionService } from "./profile-metrics-distribution.service";
import { ProfileMetricsReportService } from "./profile-metrics-report.service";
import { ProfileMetricsSummaryService } from "./profile-metrics-summary.service";
import { AuthService } from "../../auth/auth.service";
import { LibraryAccessService } from "../../libraries/library-access.service";
import { LibraryVisibility } from "../../libraries/library-visibility.constants";
import { hiddenGamesFingerprint } from "./library-audience-key";

describe("ProfileMetricsController", () => {
    let app: INestApplication;
    let getSession: jest.Mock;
    let overview: jest.Mock;
    let yearDistribution: jest.Mock;
    let typeDistribution: jest.Mock;
    let report: jest.Mock;
    let summary: jest.Mock;
    let resolve: jest.Mock;
    let hiddenGameIds: jest.Mock;

    const access = {
        audience: "everyone",
        libraryVisibility: LibraryVisibility.Public,
        canViewLibrary: true,
        visibleEntryLevels: [LibraryVisibility.Public],
    };

    beforeEach(async () => {
        getSession = jest.fn(async () => ({
            user: { id: "viewer-1", role: "user" },
        }));
        overview = jest.fn(async () => ({ totalGames: 1 }));
        yearDistribution = jest.fn(async () => ({ distribution: [] }));
        typeDistribution = jest.fn(async () => ({ distribution: [] }));
        report = jest.fn(async () => ({ reviewedInPeriod: 0 }));
        summary = jest.fn(async () => ({ period: "week" }));
        resolve = jest.fn(async () => access);
        hiddenGameIds = jest.fn(async () => [7, 9]);

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ProfileMetricsController],
            providers: [
                { provide: AuthService, useValue: { getSession } },
                {
                    provide: ProfileMetricsService,
                    useValue: { getStatsOverview: overview },
                },
                {
                    provide: ProfileMetricsDistributionService,
                    useValue: {
                        getYearDistribution: yearDistribution,
                        getTypeDistribution: typeDistribution,
                    },
                },
                {
                    provide: ProfileMetricsReportService,
                    useValue: { generateReport: report },
                },
                {
                    provide: ProfileMetricsSummaryService,
                    useValue: { generateSummary: summary },
                },
                {
                    provide: LibraryAccessService,
                    useValue: { resolve, hiddenGameIds },
                },
            ],
        }).compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it("passes the session to the overview", async () => {
        await request(app.getHttpServer())
            .get("/profile/metrics/overview/owner-1")
            .expect(200);

        expect(overview).toHaveBeenCalledWith("owner-1", "viewer-1");
    });

    it("computes the distributions with the viewer's access", async () => {
        await request(app.getHttpServer())
            .get("/profile/metrics/distribution/year/owner-1?by=finish_year")
            .expect(200);
        await request(app.getHttpServer())
            .get("/profile/metrics/distribution/type/owner-1?by=status")
            .expect(200);

        expect(yearDistribution).toHaveBeenCalledWith(
            "owner-1",
            expect.objectContaining({ by: "finish_year" }),
            access,
        );
        expect(typeDistribution).toHaveBeenCalledWith(
            "owner-1",
            expect.objectContaining({ by: "status" }),
            access,
        );
    });

    it("adds the audience and hidden fingerprint to the cached metrics", async () => {
        await request(app.getHttpServer())
            .get("/profile/metrics/report/owner-1/week")
            .expect(200);
        await request(app.getHttpServer())
            .get("/profile/metrics/summary/owner-1/month")
            .expect(200);

        const audience = {
            audience: "everyone",
            visibleEntryLevels: [LibraryVisibility.Public],
            hiddenFingerprint: hiddenGamesFingerprint([7, 9]),
        };
        expect(resolve).toHaveBeenCalledWith("viewer-1", "owner-1");
        expect(hiddenGameIds).toHaveBeenCalledWith("owner-1", [
            LibraryVisibility.Public,
        ]);
        expect(report).toHaveBeenCalledWith("owner-1", "week", audience);
        expect(summary).toHaveBeenCalledWith("owner-1", "month", audience);
    });

    it("treats an anonymous viewer as a non-follower", async () => {
        getSession.mockResolvedValue(null);
        resolve.mockResolvedValue({
            ...access,
            visibleEntryLevels: [],
            canViewLibrary: false,
        });

        await request(app.getHttpServer())
            .get("/profile/metrics/overview/owner-1")
            .expect(200);
        await request(app.getHttpServer())
            .get("/profile/metrics/report/owner-1/week")
            .expect(200);

        expect(overview).toHaveBeenCalledWith("owner-1", undefined);
        expect(resolve).toHaveBeenCalledWith(undefined, "owner-1");
        // A hidden library shares one cache entry: no hidden ids query.
        expect(hiddenGameIds).not.toHaveBeenCalled();
        expect(report).toHaveBeenCalledWith("owner-1", "week", {
            audience: "everyone",
            visibleEntryLevels: [],
            hiddenFingerprint: "all",
        });
    });
});
