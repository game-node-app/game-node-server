import { IgdbOutboundBudgetService } from "./igdb-outbound-budget.service";
import { HttpService } from "@nestjs/axios";
import { IgdbAuthService } from "../auth/igdb-auth.service";
import { catalogConfig } from "./igdb-catalog.config";
import {
    CatalogDataError,
    CatalogSourceError,
    IgdbCatalogClient,
} from "./igdb-catalog.client";
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
