import { Injectable } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric('events_received_total')
    private readonly eventsReceivedTotal: Counter<string>,

    @InjectMetric('events_published_total')
    private readonly eventsPublishedTotal: Counter<string>,

    @InjectMetric('events_publish_errors_total')
    private readonly eventsPublishErrorsTotal: Counter<string>,

    @InjectMetric('nats_connection_status')
    private readonly natsConnectionStatusGauge: Gauge<string>,

    @InjectMetric('nats_publish_duration_seconds')
    private readonly natsPublishDurationHistogram: Histogram<string>,
  ) {}

  incrementEventsReceived(source: string, count: number = 1) {
    this.eventsReceivedTotal.inc(
      {
        source,
      },
      count,
    );
  }

  incrementEventsPublished(source: string) {
    this.eventsPublishedTotal.inc({
      source,
    });
  }

  incrementPublishErrors(source: string, error: string) {
    this.eventsPublishErrorsTotal.inc({
      source,
      error_type: error,
    });
  }

  setNatsConnectionStatus(connected: boolean) {
    this.natsConnectionStatusGauge.set(connected ? 1 : 0);
  }

  recordNatsPublishDuration(subject: string, duration: number) {
    this.natsPublishDurationHistogram.observe({ subject }, duration);
  }
}

export const metricsProviders = [
  makeCounterProvider({
    name: 'events_received_total',
    help: 'Total number of events received (accepted events)',
    labelNames: ['source'],
  }),
  makeCounterProvider({
    name: 'events_published_total',
    help: 'Total number of events successfully published to NATS',
    labelNames: ['source'],
  }),
  makeCounterProvider({
    name: 'events_publish_errors_total',
    help: 'Total number of event publish errors (failed events)',
    labelNames: ['source'],
  }),
  makeGaugeProvider({
    name: 'nats_connection_status',
    help: 'NATS connection status (1 = connected, 0 = disconnected)',
  }),
  makeHistogramProvider({
    name: 'nats_publish_duration_seconds',
    help: 'Duration of NATS publish operations in seconds',
    labelNames: ['subject'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  }),
];
