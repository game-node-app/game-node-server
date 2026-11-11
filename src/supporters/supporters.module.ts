import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BillingModule } from "../billing/billing.module";
import { Profile } from "../profile/entities/profile.entity";
import { SupporterPreferencesModule } from "../profile/supporter-preferences/supporter-preferences.module";
import { SupportersController } from "./supporters.controller";
import { SupportersService } from "./supporters.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([Profile]),
        BillingModule,
        SupporterPreferencesModule,
    ],
    controllers: [SupportersController],
    providers: [SupportersService],
})
export class SupportersModule {}
