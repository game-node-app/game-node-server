import { Module } from "@nestjs/common";
import { FollowService } from "./follow.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserFollow } from "./entity/user-follow.entity";

@Module({
    imports: [TypeOrmModule.forFeature([UserFollow])],
    providers: [FollowService],
})
export class FollowModule {}
