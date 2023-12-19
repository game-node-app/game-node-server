import { Module } from "@nestjs/common";
import { UserLevelService } from "./user-level.service";
import { UserLevelController } from "./user-level.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserLevel } from "./entities/user-level.entity";

@Module({
    imports: [TypeOrmModule.forFeature([UserLevel])],
    controllers: [UserLevelController],
    providers: [UserLevelService],
})
export class UserLevelModule {}
