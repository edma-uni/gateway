/* eslint-disable @typescript-eslint/require-await */
import { Controller, Get, Post, Body, Logger, UsePipes } from '@nestjs/common';
import { JetStreamService } from './nats/jetstream.service';
import {
  EventsBatchSchema,
  ZodValidationPipe,
} from './pipes/zod-validation.pipe';
import { MetricsService } from './metrics/metrics.service';
// import type { Event } from '../../libs/types';

type Event = any; // temporary

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly jetStreamService: JetStreamService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get('health')
  async health() {
    return {
      status: 'ok',
      nats: this.jetStreamService.isConnected() ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    if (!this.jetStreamService.isConnected()) {
      throw new Error('NATS not connected');
    }

    return { status: 'ready' };
  }

  @Post('events')
  @UsePipes(new ZodValidationPipe(EventsBatchSchema))
  async handleEvent(@Body() events: Event) {
    this.logger.log(`Received a batch of ${events.length} events.`);

    let successCount = 0;
    const promises: Promise<void>[] = [];

    for (const event of events) {
      const subject = `raw.events.${event.source}.${event.funnelStage}.${event.eventType}`;

      // Track event received (accepted)
      this.metricsService.incrementEventsReceived(
        event.source,
        event.eventType,
        1,
      );

      this.logger.log(`Publishing ${event.eventId} to subject: ${subject}`);

      const publishPromise = this.jetStreamService
        .publish(subject, event)
        .then(() => {
          successCount++;

          this.metricsService.incrementEventsPublished(
            event.source,
            event.eventType,
            event.funnelStage,
          );
        })
        .catch((err) => {
          this.logger.error(`Failed to publish event ${event.eventId}:`, err);

          this.metricsService.incrementPublishErrors(
            event.source,
            event.eventType,
            err.name || 'UnknownError',
          );
        });

      promises.push(publishPromise);
    }
    await Promise.all(promises);

    this.logger.log(
      `Successfully published ${successCount} out of ${events.length} events.`,
    );

    return {
      status: 'accepted',
      received: events.length,
      processed: successCount,
    };
  }
}
