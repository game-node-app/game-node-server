import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BillingModule } from "../../billing/billing.module";
import { ProfileSupporterPreferences } from "../entities/profile-supporter-preferences.entity";
import { SupporterPreferencesController } from "./supporter-preferences.controller";
import { SupporterPreferencesService } from "./supporter-preferences.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([ProfileSupporterPreferences]),
        BillingModule,
    ],
    controllers: [SupporterPreferencesController],
    providers: [SupporterPreferencesService],
    exports: [SupporterPreferencesService],
})
export class SupporterPreferencesModule {}
