import { ConfigService } from "@nestjs/config";
import { getQueueToken } from "@nestjs/bullmq";
import { PLAYER_DATA_QUEUE } from "./player-data.constants";
import { PlayerSyncStateService } from "./player-sync-state.service";
import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { PlayerDataModule } from "./player-data.module";
import { PlayerConnectionSync } from "./entity/player-connection-sync.entity";
import { PlayerGameSync } from "./entity/player-game-sync.entity";

const source = {
    entityMetadatas: [],
    options: { type: "mysql" },
    getRepository: jest.fn((entity) => ({ target: entity })),
};
@Global()
@Module({
    providers: [
        { provide: DataSource, useValue: source },
        { provide: ConfigService, useValue: { get: () => "false" } },
    ],
    exports: [DataSource, ConfigService],
})
class FixtureDataSourceModule {}

test("new repositories resolve through the existing TypeORM datasource", async () => {
    const app = await Test.createTestingModule({
        imports: [FixtureDataSourceModule, PlayerDataModule],
    })
        .overrideProvider(getQueueToken(PLAYER_DATA_QUEUE))
        .useValue({ close: jest.fn() })
        .compile();
    try {
        expect(app.get(PlayerSyncStateService)).toBeInstanceOf(
            PlayerSyncStateService,
        );
        expect(app.get(getRepositoryToken(PlayerConnectionSync))).toEqual({
            target: PlayerConnectionSync,
        });
        expect(app.get(getRepositoryToken(PlayerGameSync))).toEqual({
            target: PlayerGameSync,
        });
    } finally {
        await app.close();
    }
});

import { MODULE_METADATA } from "@nestjs/common/constants";
import { BullModule, getQueueOptionsToken } from "@nestjs/bullmq";

test("the full-refresh queue has bounded effective Nest retention and retries", () => {
    const imports = Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        PlayerDataModule,
    );
    const registration = imports.find(
        (item: any) => item.module === BullModule,
    );
    const provider = registration.providers.find(
        (item: any) => item.provide === getQueueOptionsToken(PLAYER_DATA_QUEUE),
    );
    const options = provider.useFactory({
        getDependencyRef: () => ({
            defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
        }),
    });
    expect(options.defaultJobOptions).toEqual({
        attempts: 5,
        backoff: 5000,
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 604800, count: 1000 },
    });
});
