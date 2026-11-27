import { testEnvironment } from "../../test/igdb/helpers/test-environment";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import { createBaselineTables } from "../../test/baseline-schema";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { PlaytimeHistoryService } from "./playtime-history.service";
import { UserPlaytimeSource } from "./playtime.constants";

describe("daily playtime attribution on disposable MySQL", () => {
    const database = `playtime_daily_test_${randomUUID().replaceAll("-", "")}`;
    let source: DataSource;
    let admin: DataSource;
    let history: PlaytimeHistoryService;

    beforeAll(async () => {
        const options = {
            type: "mysql" as const,
            host: "127.0.0.1",
            port: testEnvironment(process.env).mysql.port,
            username: "root",
            password: "igdb-test-root",
            timezone: "Z",
            connectTimeout: 5000,
        };
        admin = await new DataSource(options).initialize();
        await admin.query(`CREATE DATABASE \`${database}\``);
        source = await new DataSource({
            ...options,
            database,
            entities: [resolve(__dirname, "..", "**/*.entity.ts")],
        }).initialize();
        await createBaselineTables(source, ["user_playtime_history"]);
        history = new PlaytimeHistoryService(
            source.getRepository(UserPlaytimeHistory),
            {} as any,
        );
    });

    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
        if (admin?.isInitialized) {
            await admin.query(`DROP DATABASE \`${database}\``);
            await admin.destroy();
        }
    });

    type Sample = {
        at: string;
        total: number;
        gameId?: number;
        platformId?: number;
        source?: UserPlaytimeSource;
    };

    const observe = async (userId: string, samples: Sample[]) => {
        for (const sample of samples) {
            await history.save(
                {
                    profileUserId: userId,
                    gameId: sample.gameId ?? 1,
                    source: sample.source ?? UserPlaytimeSource.PSN,
                    platformId: sample.platformId ?? 7,
                    totalPlaytimeSeconds: sample.total,
                } as any,
                new Date(sample.at),
            );
        }
    };

    const dailyTotal = (rows: { seconds: number }[]) =>
        rows.reduce((sum, row) => sum + row.seconds, 0);

    const periodTotal = async (userId: string, start: Date, end: Date) => {
        const rows = await history.getTotalPlaytimeForPeriod({
            userId,
            startDate: start,
            endDate: end,
        });
        return rows.reduce(
            (sum, row) => sum + row.totalPlaytimeInPeriodSeconds,
            0,
        );
    };

    const byDay = (rows: { day: string }[]) =>
        [...rows].sort((a, b) => a.day.localeCompare(b.day));

    it("attributes increments to the observed UTC day and sums to the period total", async () => {
        const userId = randomUUID();
        const start = new Date("2026-10-25T00:00:00.000Z");
        const end = new Date("2026-10-28T00:00:00.000Z");
        await observe(userId, [
            { at: "2026-10-24T23:00:00.000Z", total: 100 },
            { at: "2026-10-25T23:59:59.000Z", total: 160 },
            // Correction: contributes zero and becomes the next baseline.
            { at: "2026-10-26T00:00:01.000Z", total: 150 },
            { at: "2026-10-26T12:00:00.000Z", total: 180 },
            { at: "2026-10-27T23:59:59.000Z", total: 200 },
        ]);

        const daily = await history.getDailyPlaytimeForPeriod(
            userId,
            start,
            end,
        );

        expect(byDay(daily)).toEqual([
            { day: "2026-10-25", gameId: 1, platformId: 7, seconds: 60 },
            { day: "2026-10-26", gameId: 1, platformId: 7, seconds: 30 },
            { day: "2026-10-27", gameId: 1, platformId: 7, seconds: 20 },
        ]);
        expect(dailyTotal(daily)).toBe(110);
        expect(await periodTotal(userId, start, end)).toBe(110);
    });

    it("counts a first-ever sample as zero and later increments on their own day", async () => {
        const userId = randomUUID();
        const start = new Date("2026-11-01T00:00:00.000Z");
        const end = new Date("2026-12-01T00:00:00.000Z");
        await observe(userId, [
            { at: "2026-11-15T10:00:00.000Z", total: 500 },
            { at: "2026-11-16T10:00:00.000Z", total: 540 },
        ]);

        const daily = await history.getDailyPlaytimeForPeriod(
            userId,
            start,
            end,
        );

        expect(byDay(daily)).toEqual([
            { day: "2026-11-15", gameId: 1, platformId: 7, seconds: 0 },
            { day: "2026-11-16", gameId: 1, platformId: 7, seconds: 40 },
        ]);
        expect(dailyTotal(daily)).toBe(40);
        expect(await periodTotal(userId, start, end)).toBe(40);
    });

    it("merges sources per game and day while matching the period total", async () => {
        const userId = randomUUID();
        const start = new Date("2026-11-01T00:00:00.000Z");
        const end = new Date("2026-12-01T00:00:00.000Z");
        await observe(userId, [
            {
                at: "2026-10-31T12:00:00.000Z",
                total: 100,
                gameId: 1,
                platformId: 6,
                source: UserPlaytimeSource.STEAM,
            },
            {
                at: "2026-11-02T12:00:00.000Z",
                total: 130,
                gameId: 1,
                platformId: 6,
                source: UserPlaytimeSource.STEAM,
            },
            {
                at: "2026-10-31T12:00:00.000Z",
                total: 500,
                gameId: 1,
                platformId: 6,
                source: UserPlaytimeSource.XBOX,
            },
            {
                at: "2026-11-02T18:00:00.000Z",
                total: 520,
                gameId: 1,
                platformId: 6,
                source: UserPlaytimeSource.XBOX,
            },
            {
                at: "2026-10-31T12:00:00.000Z",
                total: 0,
                gameId: 2,
                platformId: 49,
                source: UserPlaytimeSource.STEAM,
            },
            {
                at: "2026-11-03T12:00:00.000Z",
                total: 100,
                gameId: 2,
                platformId: 49,
                source: UserPlaytimeSource.STEAM,
            },
        ]);

        const daily = await history.getDailyPlaytimeForPeriod(
            userId,
            start,
            end,
        );

        expect(byDay(daily)).toEqual([
            { day: "2026-11-02", gameId: 1, platformId: 6, seconds: 50 },
            { day: "2026-11-03", gameId: 2, platformId: 49, seconds: 100 },
        ]);
        expect(dailyTotal(daily)).toBe(150);
        expect(await periodTotal(userId, start, end)).toBe(150);
    });
});
