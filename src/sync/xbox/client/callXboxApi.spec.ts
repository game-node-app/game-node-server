import { setPlayerProviderBudget } from "../../player-provider-budget.service";
jest.mock("axios", () => ({
    __esModule: true,
    default: { request: jest.fn() },
}));
import axios from "axios";
import { callXboxAPI } from "./callXboxApi";

const request = jest.mocked(axios.request);
const auth = { userHash: "hash", XSTSToken: "secret-token" };

beforeEach(() => jest.resetAllMocks());

test("Xbox leaf requests carry a bounded timeout and cancellation signal", async () => {
    request.mockResolvedValue({ data: [] });
    await expect(
        callXboxAPI({ url: "https://fixture", timeout: 120000 }, auth),
    ).resolves.toEqual([]);
    expect(request.mock.calls[0][0]).toMatchObject({
        timeout: 30000,
        signal: expect.any(AbortSignal),
    });
});

test("Xbox transport errors retain status/cause/Retry-After without serializing auth material", async () => {
    const cause = {
        response: { status: 429, headers: { "retry-after": "45" } },
        config: { headers: { Authorization: "secret-token" } },
    };
    request.mockRejectedValue(cause);
    try {
        await callXboxAPI({ url: "https://fixture" }, auth);
        throw new Error("expected rejection");
    } catch (error) {
        expect(error).toMatchObject({
            outcome: "throttled",
            status: 429,
            retryAfterMs: 45000,
            cause,
        });
        expect(JSON.stringify(error)).not.toContain("secret-token");
        expect(String(error)).not.toContain("secret-token");
    }
});

test("a hung Xbox request is cancelled after 30 seconds", async () => {
    jest.useFakeTimers();
    request.mockImplementation(
        (config) =>
            new Promise((_, reject) => {
                config.signal!.addEventListener!("abort", () =>
                    reject(new Error("aborted")),
                );
            }),
    );
    try {
        const assertion = expect(
            callXboxAPI({ url: "https://fixture" }, auth),
        ).rejects.toMatchObject({ outcome: "failed" });
        await jest.advanceTimersByTimeAsync(30000);
        await assertion;
        expect(jest.getTimerCount()).toBe(0);
    } finally {
        jest.useRealTimers();
    }
});

beforeEach(() => setPlayerProviderBudget({ run: (_provider, work) => work() }));
