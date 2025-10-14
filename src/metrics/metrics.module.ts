import { Module } from '@nestjs/common';
import { MetricsService, metricsProviders } from './metrics.service';

@Module({
  providers: [MetricsService, ...metricsProviders],
  exports: [MetricsService],
})
export class MetricsModule {}
