import { Module } from '@nestjs/common';
import { ImporterService } from './importer.service';
import { ImporterController } from './importer.controller';

@Module({
  providers: [ImporterService],
  controllers: [ImporterController]
})
export class ImporterModule {}
