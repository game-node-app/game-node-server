import { Cache } from "@nestjs/cache-manager";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { setCacheManager } from "../../../utils/cacheable";
import { IgdbAuthService } from "../auth/igdb-auth.service";
import { IgdbOutboundBudgetService } from "../catalog/igdb-outbound-budget.service";
import { IGDBTimeToBeatPlaytime } from "../igdb.types";
import { IgdbPlaytimeSyncService } from "./igdb-playtime-sync.service";

const ttbRow = (gameId: number): IGDBTimeToBeatPlaytime => ({
    id: gameId,
    game_id: gameId,
    hastily: 10_800,
    normally: 21_600,
    completely: 43_200,
    count: 12,
    created_at: 0,
    updated_at: 0,
    checksum: "",
});

const idsFromQuery = (query: string) =>
    query
        .match(/where game_id = \(([^)]*)\)/)![1]
        .split(",")
        .map((id) => Number(id));

describe("IgdbPlaytimeSyncService", () => {
    const post = jest.fn();
    const run = jest.fn((work: () => Promise<unknown>) => work());
    const getAuthHeaders = jest
        .fn()
        .mockResolvedValue({ Authorization: "Bearer token" });
    let service: IgdbPlaytimeSyncService;

    beforeAll(() => {
        // The decorator caches by args; never serve a previous result here.
        setCacheManager({
            get: async () => undefined,
            set: async () => undefined,
        } as unknown as Cache);
        service = new IgdbPlaytimeSyncService(
            { post } as unknown as HttpService,
            { getAuthHeaders } as unknown as IgdbAuthService,
            {} as unknown as Cache,
            { run } as unknown as IgdbOutboundBudgetService,
        );
    });

    beforeEach(() => {
        post.mockReset();
        post.mockImplementation((_url: string, body: string) =>
            of({ data: idsFromQuery(body).map(ttbRow) }),
        );
        run.mockClear();
        getAuthHeaders.mockClear();
    });

    it("returns an empty list for an empty batch without calling IGDB", async () => {
        expect(await service.getTimesToBeat([])).toEqual([]);
        expect(post).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
        expect(getAuthHeaders).not.toHaveBeenCalled();
    });

    it("requests the full batch with an explicit limit and deduplicates ids", async () => {
        const ids = Array.from({ length: 40 }, (_, index) => 1_000 + index);

        const rows = await service.getTimesToBeat([...ids, ids[0]]);

        expect(post).toHaveBeenCalledTimes(1);
        const query = post.mock.calls[0][1] as string;
        expect(query).toContain("fields *;");
        expect(query).toContain("limit 40;");
        expect(idsFromQuery(query)).toEqual(ids);
        expect(rows.map((row) => row.game_id)).toEqual(ids);
    });

    it("splits batches above 500 ids and concatenates every chunk", async () => {
        const ids = Array.from({ length: 505 }, (_, index) => 2_000 + index);

        const rows = await service.getTimesToBeat(ids);

        expect(post).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenCalledTimes(2);
        const [firstQuery, secondQuery] = post.mock.calls.map(
            (call) => call[1] as string,
        );
        expect(firstQuery).toContain("limit 500;");
        expect(firstQuery).not.toContain("limit 505;");
        expect(idsFromQuery(firstQuery)).toEqual(ids.slice(0, 500));
        expect(secondQuery).toContain("limit 5;");
        expect(idsFromQuery(secondQuery)).toEqual(ids.slice(500));
        expect(rows.map((row) => row.game_id)).toEqual(ids);
    });
});
