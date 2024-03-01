import { Module } from "@nestjs/common";
import { FollowService } from "./follow.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserFollow } from "./entity/user-follow.entity";
import { FollowController } from './follow.controller';

@Module({
    imports: [TypeOrmModule.forFeature([UserFollow])],
    providers: [FollowService],
    controllers: [FollowController],
})
export class FollowModule {}
