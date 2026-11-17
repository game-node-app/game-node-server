import { globSync, readdirSync } from "node:fs";
import { AppDataSource } from "../../data-source";

// `migration:run` loads whatever the data source glob matches; the deploy dies on anything that
// is not a migration (e.g. a spec file, which calls `describe`).
describe("data source migration glob", () => {
    it("matches every migration and nothing else", () => {
        const [pattern] = AppDataSource.options.migrations as string[];
        const matched = globSync(pattern).map((path) => path.split("/").pop());
        const migrations = readdirSync(__dirname).filter((name) =>
            /^\d+-.*\.ts$/.test(name),
        );

        expect(migrations.length).toBeGreaterThan(0);
        expect(matched.sort()).toEqual(migrations.sort());
    });
});
