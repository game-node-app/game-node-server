import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { PlayerProviderBudgetModule } from "./player-provider-budget.module";
import {
    PLAYER_PROVIDER_BUDGET_QUEUE,
    withPlayerProviderBudget,
} from "./player-provider-budget.service";

test("Nest initialization installs the shared budget before provider work", async () => {
    const redis = {
        eval: jest.fn().mockResolvedValue(0),
        zrem: jest.fn().mockResolvedValue(1),
    };
    const module = await Test.createTestingModule({
        imports: [PlayerProviderBudgetModule],
    })
        .overrideProvider(getQueueToken(PLAYER_PROVIDER_BUDGET_QUEUE))
        .useValue({
            client: Promise.resolve(redis),
            opts: { prefix: "fixture" },
            close: jest.fn(),
        })
        .compile();
    await module.init();
    try {
        await expect(
            withPlayerProviderBudget("PSN", async () => "ready"),
        ).resolves.toBe("ready");
        expect(redis.eval).toHaveBeenCalledTimes(1);
        expect(redis.zrem).toHaveBeenCalledTimes(1);
    } finally {
        await module.close();
    }
});
