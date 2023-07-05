import { MiddlewareConsumer, NestModule, DynamicModule } from "@nestjs/common";
import { AuthModuleConfig } from "./config.interface";
export declare class AuthModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void;
    static forRoot({ connectionURI, apiKey, appInfo, }: AuthModuleConfig): DynamicModule;
}
