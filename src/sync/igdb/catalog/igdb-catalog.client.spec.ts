import { IgdbOutboundBudgetService } from "./igdb-outbound-budget.service";
import { HttpService } from "@nestjs/axios";
import { IgdbAuthService } from "../auth/igdb-auth.service";
import { catalogConfig } from "./igdb-catalog.config";
import {
    CatalogDataError,
    CatalogSourceError,
    IgdbCatalogClient,
} from "./igdb-catalog.client";
import { IGDB_SYNC_ENDPOINTS as entries } from "./igdb-sync-endpoints";
import { IGDB_CATALOG_FIELDS } from "./igdb-catalog.fields";

describe("IgdbCatalogClient", () => {
    const post = jest.fn();
    const auth = {
        getAuthHeaders: jest
            .fn()
            .mockResolvedValue({ Authorization: "fixture" }),
    };
    const config = catalogConfig({});
    const client = new IgdbCatalogClient(
        { axiosRef: { post } } as unknown as HttpService,
        auth as unknown as IgdbAuthService,
        config,
        {
            run: (work: () => Promise<unknown>) => work(),
        } as IgdbOutboundBudgetService,
    );
    beforeEach(() => {
        post.mockReset();
        auth.getAuthHeaders.mockClear();
    });
    const reply = (data: unknown, status = 200) =>
        post.mockResolvedValue({ data, status, headers: {} });

    it("captures a minimal upper boundary, including an empty catalog", async () => {
        reply([{ id: 90 }]);
        expect(await client.fetchUpperId()).toBe(90);
        expect(post.mock.calls[0][1]).toBe("fields id; sort id desc; limit 1;");
        reply([]);
        expect(await client.fetchUpperId()).toBe(0);
    });
    it("builds exact initial and resumed ascending queries with ID gaps", async () => {
        const signal = new AbortController().signal;
        reply([{ id: 2 }, { id: 19 }]);
        expect(await client.fetchPage(0, 90, 25, signal)).toEqual([
            { id: 2 },
            { id: 19 },
        ]);
        expect(post.mock.calls[0][1]).toBe(
            `fields ${IGDB_CATALOG_FIELDS.join(",")}; sort id asc; where id > 0 & id <= 90; limit 25;`,
        );
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][0]).toContain("/games");
        expect(post.mock.calls[0][2]).toMatchObject({
            timeout: 30000,
            maxContentLength: 16777216,
            signal: expect.any(AbortSignal),
        });
        reply([]);
        await client.fetchPage(19, 90, 25);
        expect(post.mock.calls[1][1]).toContain(
            "where id > 19 & id <= 90; limit 25;",
        );
    });
    it.each([
        {},
        null,
        "",
        [{ id: "2" }],
        [{ id: -1 }],
        [{ id: 3 }, { id: 2 }],
        [{ id: 2 }, { id: 2 }],
        [{ id: 101 }],
        [{ id: 1 }],
    ])("rejects malformed/unordered/out-of-bound data %j", async (data) => {
        reply(data);
        await expect(client.fetchPage(1, 100, 25)).rejects.toBeInstanceOf(
            CatalogDataError,
        );
    });
    it("rejects newly added IDs above the persisted boundary", async () => {
        reply([{ id: 91 }]);
        await expect(client.fetchPage(20, 90, 25)).rejects.toThrow("boundary");
    });
    it("accepts a valid final empty page and rejects excessive page length", async () => {
        reply([]);
        expect(await client.fetchPage(90, 90, 25)).toEqual([]);
        reply([{ id: 2 }, { id: 3 }]);
        await expect(client.fetchPage(0, 90, 1)).rejects.toThrow("limit");
    });
    it.each([429, 500, 401])("rejects HTTP %i", async (status) => {
        reply([], status);
        await expect(client.fetchUpperId()).rejects.toMatchObject({ status });
    });
    it("refreshes authentication once on 401 and retries the same query", async () => {
        post.mockResolvedValueOnce({
            status: 401,
            data: [],
            headers: {},
        }).mockResolvedValueOnce({
            status: 200,
            data: [{ id: 90 }],
            headers: {},
        });
        expect(await client.fetchUpperId()).toBe(90);
        expect(post).toHaveBeenCalledTimes(2);
        expect(auth.getAuthHeaders.mock.calls).toEqual([[false], [true]]);
        expect(post.mock.calls[0][1]).toBe(post.mock.calls[1][1]);
    });
    it("fails persistent authentication after exactly one refreshed attempt", async () => {
        reply([], 401);
        await expect(client.fetchUpperId()).rejects.toMatchObject({
            status: 401,
        });
        expect(post).toHaveBeenCalledTimes(2);
        expect(auth.getAuthHeaders.mock.calls).toEqual([[false], [true]]);
    });
    it.each(["ECONNABORTED", "ERR_BAD_RESPONSE"])(
        "propagates timeout/body-limit failures as classified errors (%s)",
        async (code) => {
            post.mockRejectedValue({
                code,
                config: { secret: "never expose" },
            });
            await expect(client.fetchUpperId()).rejects.toBeInstanceOf(
                CatalogSourceError,
            );
            await expect(client.fetchUpperId()).rejects.toThrow(code);
        },
    );
});

describe("registry queries", () => {
    const post = jest.fn();
    const client = new IgdbCatalogClient(
        { axiosRef: { post } } as any,
        { getAuthHeaders: async () => ({}) } as any,
        catalogConfig({}),
        { run: (work: any) => work() } as any,
    );
    beforeEach(() =>
        post
            .mockReset()
            .mockResolvedValue({ status: 200, data: [], headers: {} }),
    );
    it("requests checksum, ownership and declared compared fields in a sweep", async () => {
        const cover = entries.find((entry) => entry.endpoint === "covers")!;
        await client.fetchSweepPage(
            {
                ...cover,
                compare: [
                    { source: "version_parent", column: "versionParentId" },
                ],
            },
            7,
            90,
        );
        expect(post.mock.calls[0][0]).toContain("/covers");
        expect(post.mock.calls[0][1]).toBe(
            "fields id,checksum,game,version_parent,game_localization,image_type; where id > 7 & id <= 90; sort id asc; limit 500;",
        );
    });
    it("appends each endpoint's cover option sweep fields", async () => {
        await client.fetchSweepPage(
            entries.find((entry) => entry.endpoint === "artworks")!,
            7,
            90,
        );
        expect(post.mock.calls[0][1]).toBe(
            "fields id,checksum,game,artwork_type; where id > 7 & id <= 90; sort id asc; limit 500;",
        );
    });
    it("fetches expanded cover and artwork option sources in one request", async () => {
        await client.fetchOptionSources(
            entries.find((entry) => entry.endpoint === "covers")!,
            [7, 9],
        );
        expect(post.mock.calls[0][0]).toContain("/covers");
        expect(post.mock.calls[0][1]).toBe(
            "fields id,alpha_channel,animated,checksum,game,height,image_id,url,width,game_localization.game,game_localization.region.*; where id = (7,9); sort id asc; limit 500;",
        );
        await client.fetchOptionSources(
            entries.find((entry) => entry.endpoint === "artworks")!,
            [3],
        );
        expect(post.mock.calls[1][0]).toContain("/artworks");
        expect(post.mock.calls[1][1]).toBe(
            "fields id,alpha_channel,animated,checksum,game,height,image_id,url,width; where id = (3); sort id asc; limit 500;",
        );
        await expect(
            client.fetchOptionSources(
                entries.find((entry) => entry.endpoint === "covers")!,
                Array.from({ length: 501 }, (_, index) => index + 1),
            ),
        ).rejects.toBeInstanceOf(CatalogDataError);
    });
    it("uses fixed delta windows and configured expanded limits", async () => {
        await client.fetchDeltaPage(
            entries[0],
            new Date(1000000),
            new Date(2000000),
            7,
        );
        expect(post.mock.calls[0][1]).toBe(
            `fields ${IGDB_CATALOG_FIELDS.join(",")}; where updated_at >= 1000 & updated_at < 2000 & id > 7; sort id asc; limit 25;`,
        );
        await client.fetchByIds(entries[0], [2, 7]);
        expect(post.mock.calls[1][1]).toContain(
            "where id = (2,7); sort id asc; limit 25;",
        );
        await client.fetchByIds(
            entries.find((entry) => entry.endpoint === "genres")!,
            [2],
        );
        expect(post.mock.calls[2][0]).toContain("/genres");
        expect(post.mock.calls[2][1]).toContain("limit 500;");
        await expect(
            client.fetchByIds(
                entries[0],
                Array.from({ length: 26 }, (_, i) => i + 1),
            ),
        ).rejects.toBeInstanceOf(CatalogDataError);
    });
    it.each([
        [{ id: 9, updated_at: 2000 }],
        [{ id: 9, updated_at: 999 }],
        [
            { id: 9, updated_at: 1500 },
            { id: 8, updated_at: 1500 },
        ],
    ])("rejects out-of-window or unordered delta responses", async (rows) => {
        post.mockResolvedValue({ status: 200, data: rows });
        await expect(
            client.fetchDeltaPage(
                entries[0],
                new Date(1000000),
                new Date(2000000),
                0,
            ),
        ).rejects.toBeInstanceOf(CatalogDataError);
    });
});
