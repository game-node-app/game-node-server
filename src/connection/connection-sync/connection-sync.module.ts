import { Module } from '@nestjs/common';
import { ConnectionSyncGateway } from './connection-sync.gateway';

@Module({
  providers: [ConnectionSyncGateway]
})
export class ConnectionSyncModule {}
