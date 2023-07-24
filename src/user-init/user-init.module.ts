import { Module } from '@nestjs/common';
import { UserInitService } from './user-init.service';

@Module({
  providers: [UserInitService]
})
export class UserInitModule {}
