import { Module } from "@nestjs/common";
import { LevelService } from "./level.service";
import { LevelController } from "./level.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserLevel } from "./entities/user-level.entity";

@Module({
    imports: [TypeOrmModule.forFeature([UserLevel])],
    controllers: [LevelController],
    providers: [LevelService],
    exports: [LevelService],
})
export class LevelModule {}
