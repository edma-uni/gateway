import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  connect,
  NatsConnection,
  JSONCodec,
  JetStreamClient,
  JetStreamManager,
  StreamConfig,
  RetentionPolicy,
  DiscardPolicy,
  StorageType,
} from 'nats';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class JetStreamService implements OnModuleInit, OnModuleDestroy {
  private nc: NatsConnection;
  private js: JetStreamClient;
  private jsm: JetStreamManager;
  private readonly jsonCodec = JSONCodec();
  constructor(
    private readonly logger: PinoLogger,
    private readonly metricsService: MetricsService,
  ) {
    logger.setContext(JetStreamService.name);
  }

  async onModuleInit() {
    await this.connect();
    await this.ensureStreams();
  }

  private async connect() {
    try {
      this.nc = await connect({
        servers: process.env.NATS_URL,
        name: `gateway-${process.env.HOSTNAME}`,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 1000,
        timeout: 10000,
        pingInterval: 20000,
        maxPingOut: 3,
      });

      this.js = this.nc.jetstream();
      this.jsm = await this.nc.jetstreamManager();

      this.logger.info(`Connected to NATS server ${this.nc.getServer()}`);

      this.metricsService.setNatsConnectionStatus(true);

      void (async () => {
        for await (const status of this.nc.status()) {
          const statusType = status.type.toString();
          this.logger.info(
            { statusType, server: this.nc.getServer() },
            `NATS connection status changed`,
          );

          if (statusType === 'disconnect' || statusType === 'error') {
            this.metricsService.setNatsConnectionStatus(false);
          } else if (statusType === 'reconnect') {
            this.metricsService.setNatsConnectionStatus(true);
          }
        }
      })();
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error connecting to NATS server',
      );
      this.metricsService.setNatsConnectionStatus(false);
      throw error;
    }
  }

  private async ensureStreams() {
    const streams: Partial<StreamConfig>[] = [
      {
        name: 'RAW_EVENTS',
        subjects: ['raw.events.*'],
        retention: RetentionPolicy.Limits,
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
        max_msgs: 1_000_000,
        max_bytes: 1024 * 1024 * 1024, // 1GB
        discard: DiscardPolicy.Old,
        storage: StorageType.File, // Persistent storage
        num_replicas: 1, // Use 3 for production NATS cluster
        duplicate_window: 2 * 60 * 1_000_000_000, // 2 minutes deduplication
      },
    ];

    for (const streamConfig of streams) {
      try {
        await this.jsm.streams.info(streamConfig.name!);
        this.logger.info(`Stream ${streamConfig.name} already exists`);
      } catch (error: any) {
        if (error.code === '404') {
          await this.jsm.streams.add(streamConfig);
          this.logger.info(`Stream ${streamConfig.name} created`);
        } else {
          throw error;
        }
      }
    }
  }

  async publish(subject: string, payload: unknown) {
    if (!this.js) {
      throw new Error('JetStream is not initialized');
    }

    const startTime = Date.now();

    try {
      const ack = await this.js.publish(
        subject,
        this.jsonCodec.encode(payload),
        {
          msgID: this.generateMessageId(payload),
          timeout: 5000, // 5 seconds timeout
        },
      );

      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordNatsPublishDuration(subject, duration);

      this.logger.debug(
        `Published to ${subject}: seq=${ack.seq}, duplicate=${ack.duplicate}`,
      );

      return ack;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordNatsPublishDuration(subject, duration);

      this.logger.error(`Failed to publish to subject ${subject}`, error);
      throw error;
    }
  }

  private generateMessageId(payload: any): string {
    // Use event ID if available for deduplication
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const eventId: unknown = payload?.eventId;
    return (
      (typeof eventId === 'string' ? eventId : null) ||
      `${Date.now()}-${Math.random()}`
    );
  }

  async onModuleDestroy() {
    if (this.nc) {
      this.logger.info('Draining NATS connection for graceful shutdown');
      await this.nc.drain();
      this.logger.info('NATS connection drained and closed');
    }
  }

  isConnected(): boolean {
    return this.nc && !this.nc.isClosed();
  }

  getConnection(): NatsConnection {
    return this.nc;
  }
}
