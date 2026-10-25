jest.mock("../game-achievement.module", () => ({
    GameAchievementModule: class {},
}));
jest.mock("./game-achievement-sync.processor", () => ({
    GameAchievementSyncProcessor: class {},
}));

import { DynamicModule } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { BullModule } from "@nestjs/bullmq";
import { getQueueOptionsToken } from "@nestjs/bullmq/dist/utils";
import { GameAchievementSyncModule } from "./game-achievement-sync.module";
import { GAME_ACHIEVEMENT_SYNC_QUEUE_NAME } from "./game-achievement-sync.constants";

describe("achievement queue registration", () => {
    it("retains bounded history alongside local retry options after Nest composition", () => {
        const imports: DynamicModule[] = Reflect.getMetadata(
            MODULE_METADATA.IMPORTS,
            GameAchievementSyncModule,
        );
        const registration = imports.find(
            (item) => item.module === BullModule,
        )!;
        const provider = registration.providers!.find(
            (item: any) =>
                item.provide ===
                getQueueOptionsToken(GAME_ACHIEVEMENT_SYNC_QUEUE_NAME),
        ) as any;
        const options = provider.useFactory({
            getDependencyRef: () => ({
                connection: { host: "localhost", port: 6379 },
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: true,
                    attempts: 3,
                },
            }),
        });
        expect(options.connection).toEqual({ host: "localhost", port: 6379 });
        expect(options.defaultJobOptions).toEqual({
            attempts: 5,
            backoff: 5000,
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 604800, count: 1000 },
        });
    });
});
