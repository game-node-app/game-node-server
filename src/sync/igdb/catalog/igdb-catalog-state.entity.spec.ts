import { getMetadataArgsStorage } from "typeorm";
import { IgdbCatalogState } from "./entities/igdb-catalog-state.entity";

describe("catalog state metadata", () => {
    it("stores a singleton with nullable ownership before its first run", () => {
        const state = new IgdbCatalogState();
        expect(state).toMatchObject({
            id: 1,
            status: "idle",
            runId: null,
            upperId: null,
            ownerToken: null,
            leaseExpiresAt: null,
        });
        const storage = getMetadataArgsStorage();
        expect(
            storage.tables.find((table) => table.target === IgdbCatalogState)
                ?.name,
        ).toBe("igdb_catalog_state");
        expect(
            storage.checks.find((check) => check.target === IgdbCatalogState)
                ?.expression,
        ).toBe("`id` = 1");
        expect(
            storage.columns.filter(
                (column) => column.target === IgdbCatalogState,
            ),
        ).toHaveLength(19);
    });
});
