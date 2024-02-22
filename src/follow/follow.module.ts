import { Module } from "@nestjs/common";
import { FollowService } from './follow.service';

@Module({
  providers: [FollowService]
})
export class FollowModule {}
