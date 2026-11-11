import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { AuthService } from "../auth/auth.service";
import { SupporterPreferencesService } from "../profile/supporter-preferences/supporter-preferences.service";
import { SupportersModule } from "./supporters.module";
import { SupportersService } from "./supporters.service";

const dataSource = {
    options: { type: "mysql" },
    entityMetadatas: [],
    getRepository: jest.fn((entity) => ({ target: entity })),
};

@Global()
@Module({
    providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: AuthService, useValue: { getSession: jest.fn() } },
        {
            provide: ConfigService,
            useValue: { get: jest.fn(), getOrThrow: jest.fn(() => "http://x") },
        },
        {
            provide: CACHE_MANAGER,
            useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
    ],
    exports: [DataSource, AuthService, ConfigService, CACHE_MANAGER],
})
class FixtureModule {}

test("SupportersModule resolves with BillingModule and SupporterPreferencesModule and no provider cycle", async () => {
    const module = await Test.createTestingModule({
        imports: [FixtureModule, SupportersModule],
    }).compile();

    try {
        expect(module.get(SupportersService)).toBeInstanceOf(SupportersService);
        expect(module.get(SupporterPreferencesService)).toBeInstanceOf(
            SupporterPreferencesService,
        );
    } finally {
        await module.close();
    }
});
