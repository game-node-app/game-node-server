jest.mock("axios");
import axios from "axios";
import { NintendoSyncService } from "./nintendo-sync.service";
import { setPlayerProviderBudget } from "../player-provider-budget.service";

const get = jest.mocked(axios.get);
const authService = { getAccessToken: jest.fn().mockResolvedValue("token") };
const budgetRun = jest.fn((_provider: string, work: () => any) => work());
const service = new NintendoSyncService(authService as any);

const entry = (overrides: object = {}) => ({
    titleId: "0100abcdef123000",
    titleName: "Game",
    platform: "HAC",
    totalPlayedMinutes: 250,
    firstPlayedAt: "2026-08-25T10:00:00Z",
    lastPlayedAt: "2026-08-29T10:00:00Z",
    ...overrides,
});
const respond = (data: object) => get.mockResolvedValueOnce({ data });

beforeEach(() => {
    jest.clearAllMocks();
    setPlayerProviderBudget({ run: budgetRun } as any);
});

describe("NintendoSyncService.getPlayHistory", () => {
    it("normalizes an entry, upper-cases the title ID and sends the locale", async () => {
        respond({ playHistories: [entry()], hiddenTitleList: [] });
        const result = await service.getPlayHistory("acct");
        expect(result).toEqual([
            {
                titleId: "0100ABCDEF123000",
                titleName: "Game",
                platform: "HAC",
                minutes: 250,
                firstPlayedAt: new Date("2026-08-25T10:00:00Z"),
                lastPlayedAt: new Date("2026-08-29T10:00:00Z"),
            },
        ]);
        expect(get.mock.calls[0][1]?.headers).toMatchObject({
            Authorization: "Bearer token",
            "gentry-locale": "en-US",
        });
        expect(budgetRun.mock.calls[0][0]).toBe("nintendo:user:acct");
    });

    it("accepts deviceType in place of platform", async () => {
        respond({
            playHistories: [
                { ...entry(), platform: undefined, deviceType: "BEE" },
            ],
        });
        expect((await service.getPlayHistory("acct"))[0].platform).toBe("BEE");
    });

    it("fails as incomplete on an invalid entry without logging values", async () => {
        const errors = jest.spyOn((service as any).logger, "error");
        respond({ playHistories: [entry({ titleId: "secret-value" })] });
        await expect(service.getPlayHistory("acct")).rejects.toMatchObject({
            outcome: "incomplete",
        });
        expect(errors.mock.calls[0][0]).toContain("titleId");
        expect(errors.mock.calls[0][0]).not.toContain("secret-value");
    });

    it("fails as incomplete without playHistories", async () => {
        respond({});
        await expect(service.getPlayHistory("acct")).rejects.toMatchObject({
            outcome: "incomplete",
        });
    });

    it("returns [] for an empty history", async () => {
        respond({ playHistories: [], hiddenTitleList: [] });
        await expect(service.getPlayHistory("acct")).resolves.toEqual([]);
    });

    it("drops hidden titles in string and object form", async () => {
        respond({
            playHistories: [
                entry({ titleId: "0100000000000001" }),
                entry({ titleId: "0100000000000002" }),
                entry({ titleId: "0100000000000003" }),
            ],
            hiddenTitleList: [
                "0100000000000001",
                { titleId: "0100000000000002" },
            ],
        });
        const result = await service.getPlayHistory("acct");
        expect(result.map((e) => e.titleId)).toEqual(["0100000000000003"]);
    });

    it("skips other platforms without failing", async () => {
        respond({ playHistories: [entry({ platform: "XYZ" }), entry()] });
        await expect(service.getPlayHistory("acct")).resolves.toHaveLength(1);
    });
});
