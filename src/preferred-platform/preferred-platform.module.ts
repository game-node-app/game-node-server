import { Module } from "@nestjs/common";
import { PreferredPlatformService } from "./preferred-platform.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PreferredPlatform } from "./entity/preferred-platform.entity";
import { PreferredPlatformController } from "./preferred-platform.controller";

@Module({
    imports: [TypeOrmModule.forFeature([PreferredPlatform])],
    providers: [PreferredPlatformService],
    controllers: [PreferredPlatformController],
})
export class PreferredPlatformModule {}
