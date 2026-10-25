import { Module } from "@nestjs/common";
import { ConnectionProviderRegistry } from "./connection-provider.registry";

@Module({
    providers: [ConnectionProviderRegistry],
    exports: [ConnectionProviderRegistry],
})
export class ConnectionProviderModule {}
