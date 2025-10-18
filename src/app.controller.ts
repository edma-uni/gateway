import {
  Controller,
  Get,
  Post,
  Body,
  UsePipes,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { JetStreamService } from './nats/jetstream.service';
import {
  EventsBatchSchema,
  ZodValidationPipe,
} from './pipes/zod-validation.pipe';
import { MetricsService } from './metrics/metrics.service';
import type { Event, EventBatch } from './types/event.types';

@Controller()
export class AppController {
  constructor(
    private readonly logger: PinoLogger,
    private readonly jetStreamService: JetStreamService,
    private readonly metricsService: MetricsService,
  ) {
    logger.setContext(AppController.name);
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  ready() {
    if (!this.jetStreamService.isConnected()) {
      throw new HttpException(
        {
          status: 'not ready',
          reason: 'NATS not connected',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('events')
  @UsePipes(new ZodValidationPipe(EventsBatchSchema))
  async handleEvent(@Body() events: EventBatch, @Req() req: Request) {
    const correlationId = req.correlationId;

    this.logger.info(
      {
        correlationId,
        eventCount: events.length,
      },
      `Received event batch`,
    );

    let successCount = 0;
    const promises: Promise<void>[] = [];

    for (const event of events) {
      const enrichedEvent: Event = {
        ...event,
        correlationId,
        timestamp: event.timestamp || new Date().toISOString(),
      };

      const subject = `raw.events.${event.source}`;

      this.metricsService.incrementEventsReceived(
        event.source,
        event.eventType,
        1,
      );

      this.logger.debug(
        {
          correlationId,
          eventId: event.eventId,
          subject,
          source: event.source,
          eventType: event.eventType,
        },
        `Publishing event`,
      );

      const publishPromise = this.jetStreamService
        .publish(subject, enrichedEvent)
        .then(() => {
          successCount++;

          this.metricsService.incrementEventsPublished(
            event.source,
            event.eventType,
            event.funnelStage,
          );
        })
        .catch((err: Error) => {
          this.logger.error(
            {
              correlationId,
              eventId: event.eventId,
              error: err.message,
              errorName: err.name,
            },
            `Failed to publish event`,
          );

          this.metricsService.incrementPublishErrors(
            event.source,
            event.eventType,
            err.name || 'UnknownError',
          );
        });

      promises.push(publishPromise);
    }
    await Promise.all(promises);

    this.logger.info(
      {
        correlationId,
        received: events.length,
        processed: successCount,
        failed: events.length - successCount,
      },
      `Event batch processed`,
    );

    return {
      status: 'accepted',
      received: events.length,
      processed: successCount,
      failed: events.length - successCount,
      correlationId,
    };
  }
}
