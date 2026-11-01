jest.mock("axios");
import axios from "axios";
import { EpicNamespaceFillProcessor } from "./epic-namespace-fill.processor";
import {
    EGameCategory,
    EGameExternalGameCategory,
} from "../game-repository/game-repository.constants";

const get = jest.mocked(axios.get);
const NS = EGameExternalGameCategory.EpicGamesNamespace;
const url = (slug: string) => `https://store.epicgames.com/en-US/p/${slug}`;

interface Row {
    id: number;
    slug: string;
    gameId: number;
    category?: EGameCategory;
}

function setup(
    rows: Row[],
    namespaces: Record<string, string | null>,
    existingUids: string[] = [],
) {
    const find = jest.fn(async ({ where, take }) =>
        rows
            .filter((row) => row.id > where.id.value)
            .slice(0, take)
            .map((row) => ({
                id: row.id,
                url: url(row.slug),
                gameId: row.gameId,
                game: { category: row.category ?? EGameCategory.Main },
            })),
    );
    const externalGameService = {
        getExternalGamesForSourceIds: jest.fn(async (uids: string[]) =>
            uids
                .filter((uid) => existingUids.includes(uid))
                .map((uid) => ({ uid })),
        ),
        insertReserved: jest.fn(),
        registerUnmappedGames: jest.fn(),
    };
    get.mockImplementation(async (requestUrl: string) => {
        const slug = decodeURIComponent(requestUrl.split("/").pop()!);
        const namespace = namespaces[slug];
        if (namespace === null) throw new Error("404");
        return { data: namespace ? { namespace } : {} };
    });
    const processor = new EpicNamespaceFillProcessor(
        { find } as any,
        externalGameService as any,
    );
    (processor as any).sleep = async () => {};
    const job = {
        name: "epic-namespace-fill",
        data: {} as any,
        updateData: jest.fn(async (data) => {
            job.data = data;
        }),
    };
    return { processor, job, find, externalGameService };
}

beforeEach(() => jest.clearAllMocks());

describe("EpicNamespaceFillProcessor", () => {
    it("writes a bulk mapping when every store page of a namespace leads to one game", async () => {
        const { processor, job, externalGameService } = setup(
            [
                { id: 1, slug: "hades", gameId: 10 },
                { id: 2, slug: "hades-bundle-page", gameId: 10 },
            ],
            { hades: "ns-a", "hades-bundle-page": "ns-a" },
        );
        const summary = await processor.process(job as any);
        expect(externalGameService.insertReserved).toHaveBeenCalledTimes(1);
        expect(externalGameService.insertReserved).toHaveBeenCalledWith({
            uid: "ns-a",
            category: NS,
            gameId: 10,
            url: url("hades"),
            origin: "bulk",
        });
        expect(summary).toEqual({
            slugs: 2,
            resolved: 2,
            failed: 0,
            mapped: 1,
            ambiguous: 0,
        });
    });

    it("registers a namespace shared by several main games as unmapped and writes nothing", async () => {
        const { processor, job, externalGameService } = setup(
            [
                { id: 1, slug: "one", gameId: 10 },
                { id: 2, slug: "two", gameId: 11 },
            ],
            { one: "ns-a", two: "ns-a" },
        );
        const summary = await processor.process(job as any);
        expect(externalGameService.insertReserved).not.toHaveBeenCalled();
        expect(externalGameService.registerUnmappedGames).toHaveBeenCalledWith(
            NS,
            [{ sourceUid: "ns-a" }],
        );
        expect(summary).toMatchObject({ mapped: 0, ambiguous: 1 });
    });

    it("maps a namespace shared by a main game and its add-ons to the main game", async () => {
        const { processor, job, externalGameService } = setup(
            [
                { id: 1, slug: "base", gameId: 10 },
                {
                    id: 2,
                    slug: "dlc",
                    gameId: 11,
                    category: EGameCategory.DlcAddon,
                },
                {
                    id: 3,
                    slug: "pack",
                    gameId: 12,
                    category: EGameCategory.Pack,
                },
            ],
            { base: "ns-a", dlc: "ns-a", pack: "ns-a" },
        );
        await processor.process(job as any);
        expect(externalGameService.insertReserved).toHaveBeenCalledWith(
            expect.objectContaining({ uid: "ns-a", gameId: 10 }),
        );
        expect(
            externalGameService.registerUnmappedGames,
        ).not.toHaveBeenCalled();
    });

    it("leaves an existing mapping for the namespace untouched", async () => {
        const { processor, job, externalGameService } = setup(
            [
                { id: 1, slug: "one", gameId: 10 },
                { id: 2, slug: "two", gameId: 11 },
            ],
            { one: "ns-a", two: "ns-b" },
            ["ns-a"],
        );
        const summary = await processor.process(job as any);
        expect(externalGameService.insertReserved).toHaveBeenCalledTimes(1);
        expect(externalGameService.insertReserved).toHaveBeenCalledWith(
            expect.objectContaining({ uid: "ns-b" }),
        );
        expect(summary.mapped).toBe(1);
    });

    it("skips slugs Epic cannot resolve, counts them and continues", async () => {
        const { processor, job, externalGameService } = setup(
            [
                { id: 1, slug: "gone", gameId: 10 },
                { id: 2, slug: "empty", gameId: 11 },
                { id: 3, slug: "ok", gameId: 12 },
            ],
            { gone: null, empty: "", ok: "ns-ok" },
        );
        const summary = await processor.process(job as any);
        expect(summary).toEqual({
            slugs: 3,
            resolved: 1,
            failed: 2,
            mapped: 1,
            ambiguous: 0,
        });
        expect(externalGameService.insertReserved).toHaveBeenCalledWith(
            expect.objectContaining({ uid: "ns-ok", gameId: 12 }),
        );
    });

    it("resumes after lastId and still sees candidates saved from earlier pages", async () => {
        const { processor, job, find, externalGameService } = setup(
            [
                { id: 1, slug: "one", gameId: 10 },
                { id: 2, slug: "two", gameId: 11 },
            ],
            { two: "ns-a" },
        );
        job.data = {
            lastId: 1,
            slugs: 1,
            resolved: 1,
            groups: {
                "ns-a": { 10: { category: EGameCategory.Main, slug: "one" } },
            },
        };
        const summary = await processor.process(job as any);
        expect(find.mock.calls[0][0].where.id.value).toBe(1);
        expect(get).toHaveBeenCalledTimes(1);
        expect(externalGameService.registerUnmappedGames).toHaveBeenCalledWith(
            NS,
            [{ sourceUid: "ns-a" }],
        );
        expect(summary).toMatchObject({ slugs: 2, resolved: 2, ambiguous: 1 });
    });

    it("persists the cursor after every page", async () => {
        const rows = Array.from({ length: 501 }, (_, i) => ({
            id: i + 1,
            slug: `game-${i + 1}`,
            gameId: i + 1,
        }));
        const { processor, job } = setup(
            rows,
            Object.fromEntries(rows.map((r) => [r.slug, `ns-${r.id}`])),
        );
        await processor.process(job as any);
        expect(job.updateData.mock.calls.map((c) => c[0].lastId)).toEqual([
            500, 501,
        ]);
    });
});
