import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { AuthService } from "../../auth/auth.service";
import { BillingService } from "../../billing/billing.service";
import { SupporterGuard } from "../../billing/supporter.guard";
import { NotificationsModule } from "../../notifications/notifications.module";
import { UploadService } from "../../upload/upload.service";
import { ProfileVideoModule } from "../profile-video/profile-video.module";
import { ProfileVideoService } from "../profile-video/profile-video.service";
import { ProfileModule } from "../profile.module";
import { SupporterPreferencesService } from "./supporter-preferences.service";

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
        { provide: UploadService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: { del: jest.fn() } },
        { provide: ProfileVideoService, useValue: {} },
    ],
    exports: [
        DataSource,
        AuthService,
        ConfigService,
        UploadService,
        CACHE_MANAGER,
        ProfileVideoService,
    ],
})
class FixtureModule {}

@Module({})
class EmptyModule {}

test("ProfileModule resolves SupporterPreferencesModule with BillingModule and no provider cycle", async () => {
    const module = await Test.createTestingModule({
        imports: [FixtureModule, ProfileModule],
    })
        .overrideModule(NotificationsModule)
        .useModule(EmptyModule)
        .overrideModule(ProfileVideoModule)
        .useModule(EmptyModule)
        .compile();

    try {
        expect(module.get(SupporterPreferencesService)).toBeInstanceOf(
            SupporterPreferencesService,
        );
        expect(module.get(BillingService)).toBeInstanceOf(BillingService);
        expect(module.get(SupporterGuard)).toBeInstanceOf(SupporterGuard);
    } finally {
        await module.close();
    }
});
