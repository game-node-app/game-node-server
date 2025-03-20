import { Module } from '@nestjs/common';
import { TurnstileService } from './turnstile.service';

@Module({
  providers: [TurnstileService]
})
export class TurnstileModule {}
