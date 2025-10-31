import { Module } from "@nestjs/common";
import { PreferredPlatformService } from "./preferred-platform.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PreferredPlatform } from "./entity/preferred-platform.entity";
import { PreferredPlatformReorderService } from './preferred-platform-reorder.service';

@Module({
    imports: [TypeOrmModule.forFeature([PreferredPlatform])],
    providers: [PreferredPlatformService, PreferredPlatformReorderService],
})
export class PreferredPlatformModule {}
