import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { JetStreamService } from './nats/jetstream.service';
import { MetricsService } from './metrics/metrics.service';
import z from 'zod';

const MinValidEventSchema = z.looseObject({
  source: z.enum(['facebook', 'tiktok']),
});
type MinValidEvent = z.infer<typeof MinValidEventSchema>;

const MinValidEventsSchema = MinValidEventSchema.array();

type MinValidEvents = z.infer<typeof MinValidEventsSchema>;

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
  async handleEvent(@Body() events: MinValidEvents, @Req() req: Request) {
    const correlationId = req.correlationId;

    const validationResult = MinValidEventsSchema.safeParse(events);

    if (!validationResult.success) {
      this.logger.warn('Invalid event batch received', {
        correlationId,
        error: z.treeifyError(validationResult.error),
      });
    }

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
      const enrichedEvent: MinValidEvent = {
        ...event,
        correlationId,
        timestamp: new Date().toISOString(),
      };

      const subject = `events.${event.source}`;

      this.metricsService.incrementEventsReceived(event.source, 1);

      this.logger.debug(
        {
          correlationId,
          subject,
          source: event.source,
        },
        `Publishing event`,
      );

      const publishPromise = this.jetStreamService
        .publish(subject, enrichedEvent)
        .then(() => {
          successCount++;

          this.metricsService.incrementEventsPublished(event.source);
        })
        .catch((err: Error) => {
          this.logger.error(
            {
              correlationId,
              error: err.message,
              errorName: err.name,
            },
            `Failed to publish event`,
          );

          this.metricsService.incrementPublishErrors(
            event.source,
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
