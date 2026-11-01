import { existsSync } from "node:fs";
import { join } from "node:path";
import {
    ACHIEVEMENT_METRICS,
    validateMetricCriteria,
} from "./metrics/achievement-metrics";
import { SeedTieredPlatformAchievements1794000000000 } from "../migrations/1794000000000-SeedTieredPlatformAchievements";

describe("SeedTieredPlatformAchievements", () => {
    it("seeds valid drafts with ascending tiers", async () => {
        const queries: Array<[string, any[]]> = [];
        await new SeedTieredPlatformAchievements1794000000000().up({
            query: async (sql: string, params: any[]) => {
                queries.push([sql, params]);
                return { affectedRows: 1 };
            },
        } as any);

        const definitions = queries.filter(([sql]) =>
            sql.includes("achievement_definition"),
        );
        const tiers = queries.filter(([sql]) =>
            sql.includes("achievement_tier"),
        );
        expect(definitions.length).toBeGreaterThan(0);
        expect(new Set(definitions.map(([, p]) => p[0])).size).toBe(
            definitions.length,
        );

        for (const [
            ,
            [id, name, description, , metric, criteria, icon],
        ] of definitions) {
            expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
            expect(id.length).toBeLessThanOrEqual(36);
            expect(name.length).toBeLessThanOrEqual(100);
            expect(description.length).toBeLessThanOrEqual(500);
            expect(
                validateMetricCriteria(
                    ACHIEVEMENT_METRICS.get(metric)!,
                    JSON.parse(criteria),
                ),
            ).toEqual([]);
            const parsed = JSON.parse(icon);
            expect(parsed.kind).toMatch(/^(image|game_cover)$/);
            if (parsed.kind === "image")
                expect(
                    existsSync(
                        join(
                            __dirname,
                            "../../public/icons",
                            `${parsed.name}.png`,
                        ),
                    ),
                ).toBe(true);

            const own = tiers.filter(([, p]) => p[0] === id).map(([, p]) => p);
            expect(own.length).toBeGreaterThanOrEqual(1);
            expect(own.length).toBeLessThanOrEqual(10);
            own.forEach(([, level, threshold, exp], index) => {
                expect(level).toBe(index + 1);
                expect(exp).toBeGreaterThanOrEqual(0);
                expect(exp).toBeLessThanOrEqual(5000);
                if (index > 0)
                    expect(threshold).toBeGreaterThan(own[index - 1][2]);
            });
        }
    });

    it("skips ids that already exist instead of failing", async () => {
        const queries: string[] = [];
        await new SeedTieredPlatformAchievements1794000000000().up({
            query: async (sql: string) => {
                queries.push(sql);
                return { affectedRows: 0 };
            },
        } as any);
        expect(queries.every((sql) => sql.startsWith("INSERT IGNORE"))).toBe(
            true,
        );
    });
});
