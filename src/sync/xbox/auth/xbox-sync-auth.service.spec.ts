import { setPlayerProviderBudget } from "../../player-provider-budget.service";
jest.mock("@xboxreplay/xboxlive-auth", () => ({ authenticate: jest.fn() }));
import { authenticate } from "@xboxreplay/xboxlive-auth";
import { XboxSyncAuthService } from "./xbox-sync-auth.service";

test("Xbox authentication preserves exposed status/cause without exposing credentials", async () => {
    const cause = {
        data: { attributes: { extra: { statusCode: 403 } } },
        message: "password=secret",
    };
    jest.mocked(authenticate).mockRejectedValue(cause);
    const service = new XboxSyncAuthService(
        {
            get: (key: string) =>
                key === "XBOX_API_USER" ? "fixture@example.com" : "secret",
        } as any,
        { get: jest.fn().mockResolvedValue(undefined) } as any,
    );
    const error = await service.getAuthCredentials().catch((error) => error);
    expect(error).toMatchObject({ outcome: "unavailable", status: 403, cause });
    expect(JSON.stringify(error)).not.toContain("secret");
});

beforeEach(() => setPlayerProviderBudget({ run: (_provider, work) => work() }));
