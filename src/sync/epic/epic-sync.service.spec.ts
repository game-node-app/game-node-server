jest.mock("axios");
import axios from "axios";
import { EpicSyncService } from "./epic-sync.service";
import { setPlayerProviderBudget } from "../player-provider-budget.service";

const get = jest.mocked(axios.get);
const authService = { getAccessToken: jest.fn().mockResolvedValue("token") };
const budgetRun = jest.fn((_provider: string, work: () => any) => work());
const service = new EpicSyncService(authService as any);

const record = (namespace: string, appName: string) => ({
    namespace,
    appName,
    catalogItemId: appName,
});

beforeEach(() => {
    jest.clearAllMocks();
    setPlayerProviderBudget({ run: budgetRun } as any);
});

describe("EpicSyncService", () => {
    it("merges cursor pages, drops Unreal Engine items and budgets per account", async () => {
        get.mockResolvedValueOnce({
            data: {
                records: [record("game", "a"), record("ue", "asset")],
                responseMetadata: { nextCursor: "c2" },
            },
        });
        get.mockResolvedValueOnce({
            data: { records: [record("other", "b")], responseMetadata: {} },
        });

        const items = await service.getLibraryItems("acct-1");

        expect(items.map((i) => i.appName)).toEqual(["a", "b"]);
        expect(get).toHaveBeenCalledTimes(2);
        expect(get.mock.calls[1][1]?.params).toMatchObject({ cursor: "c2" });
        expect(get.mock.calls[0][1]?.headers).toMatchObject({
            Authorization: "Bearer token",
        });
        expect(budgetRun.mock.calls.map((c) => c[0])).toEqual([
            "epicgames:user:acct-1",
            "epicgames:user:acct-1",
        ]);
    });

    it("rejects a cursor that does not advance", async () => {
        get.mockResolvedValue({
            data: { records: [], responseMetadata: { nextCursor: "same" } },
        });
        await expect(service.getLibraryItems("acct-1")).rejects.toMatchObject({
            outcome: "incomplete",
        });
    });

    it("reads playtime for the account under its own budget key", async () => {
        get.mockResolvedValueOnce({
            data: [{ artifactId: "a", totalTime: 7200 }],
        });
        await expect(service.getPlaytime("acct-2")).resolves.toEqual([
            { artifactId: "a", totalTime: 7200 },
        ]);
        expect(get.mock.calls[0][0]).toContain("/playtime/account/acct-2/all");
        expect(budgetRun.mock.calls[0][0]).toBe("epicgames:user:acct-2");
    });

    it("prefers the base game over an add-on when naming a namespace", async () => {
        get.mockResolvedValueOnce({
            data: {
                dlc: {
                    title: "Game - Soundtrack",
                    mainGameItem: { id: "base" },
                },
                base: { title: "Game" },
            },
        });
        await expect(
            service.getCatalogTitle("acct-1", "ns", ["dlc", "base"]),
        ).resolves.toBe("Game");
        expect(get.mock.calls[0][0]).toContain("/ns/bulk/items");
        expect(String(get.mock.calls[0][1]?.params)).toContain(
            "id=dlc&id=base",
        );
    });

    it("returns no title when the catalog lookup fails", async () => {
        get.mockRejectedValueOnce(new Error("503"));
        await expect(
            service.getCatalogTitle("acct-1", "ns", ["a"]),
        ).resolves.toBeUndefined();
    });
});
