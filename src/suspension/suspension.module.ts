import { Module } from "@nestjs/common";
import { SuspensionService } from "./suspension.service";
import { UserSuspension } from "./entity/user-suspension.entity";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SuspensionGuard } from "./suspension.guard";

/**
 * Module responsible for handling user suspension and banning.
 * These limit a user's ability to interact with others, but still allows them
 * to use their library and non-community related features.
 */
@Module({
    imports: [TypeOrmModule.forFeature([UserSuspension])],
    providers: [SuspensionService, SuspensionGuard],
    exports: [SuspensionGuard, SuspensionService],
})
export class SuspensionModule {}
