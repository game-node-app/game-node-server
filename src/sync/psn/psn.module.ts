import { Module } from '@nestjs/common';
import { PsnService } from './psn.service';
import { PsnAuthService } from './psn-auth.service';

@Module({
  providers: [PsnService, PsnAuthService]
})
export class PsnModule {}
