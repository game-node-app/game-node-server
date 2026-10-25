jest.mock("../../connection/connections.module", () => ({
    ConnectionsModule: class {},
}));
jest.mock("../importer.module", () => ({ ImporterModule: class {} }));
jest.mock("../../libraries/libraries.module", () => ({
    LibrariesModule: class {},
}));
jest.mock("../../notifications/notifications.module", () => ({
    NotificationsModule: class {},
}));
jest.mock(
    "../../collections/collections-entries/collections-entries.module",
    () => ({ CollectionsEntriesModule: class {} }),
);
jest.mock("./importer-watch.service", () => ({
    ImporterWatchService: class {},
}));
jest.mock("./importer-watch.processor", () => ({
    ImporterWatchProcessor: class {},
}));
jest.mock("./importer-watch.controller", () => ({
    ImporterWatchController: class {},
}));

import { DynamicModule } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { BullModule } from "@nestjs/bullmq";
import { getQueueOptionsToken } from "@nestjs/bullmq/dist/utils";
import { ImporterWatchModule } from "./importer-watch.module";
import { IMPORTER_WATCH_QUEUE_NAME } from "./importer-watch.constants";

describe("importer queue registration", () => {
    it("retains bounded history alongside local retry options after Nest composition", () => {
        const imports: DynamicModule[] = Reflect.getMetadata(
            MODULE_METADATA.IMPORTS,
            ImporterWatchModule,
        );
        const registration = imports.find(
            (item) => item.module === BullModule,
        )!;
        const provider = registration.providers!.find(
            (item: any) =>
                item.provide ===
                getQueueOptionsToken(IMPORTER_WATCH_QUEUE_NAME),
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
