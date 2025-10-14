import { Module } from '@nestjs/common';
import { JetStreamService } from './jetstream.service';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [MetricsModule],
  providers: [JetStreamService],
  exports: [JetStreamService],
})
export class NatsModule {}
