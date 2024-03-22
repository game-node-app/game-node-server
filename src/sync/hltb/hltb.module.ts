import { Module } from '@nestjs/common';
import { HltbService } from './hltb.service';
import { HltbController } from './hltb.controller';

@Module({
  providers: [HltbService],
  controllers: [HltbController]
})
export class HltbModule {}
