import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppController } from './app.controller';
import { JetStreamService } from './nats/jetstream.service';
import { MetricsService } from './metrics/metrics.service';
import type { Request } from 'express';

describe('AppController', () => {
  let appController: AppController;
  let mockLogger: Partial<PinoLogger>;
  let mockJetStreamService: Partial<JetStreamService>;
  let mockMetricsService: Partial<MetricsService>;

  beforeEach(async () => {
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    mockJetStreamService = {
      isConnected: jest.fn(),
      publish: jest.fn(),
    };

    mockMetricsService = {
      incrementEventsReceived: jest.fn(),
      incrementEventsPublished: jest.fn(),
      incrementPublishErrors: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
        {
          provide: JetStreamService,
          useValue: mockJetStreamService,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return ok status', () => {
      const result = appController.health();
      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('ready', () => {
    it('should return ready when NATS is connected', () => {
      (mockJetStreamService.isConnected as jest.Mock).mockReturnValue(true);

      const result = appController.ready();
      expect(result.status).toBe('ready');
      expect(result.timestamp).toBeDefined();
    });

    it('should throw exception when NATS is not connected', () => {
      (mockJetStreamService.isConnected as jest.Mock).mockReturnValue(false);

      expect(() => appController.ready()).toThrow(HttpException);
      try {
        appController.ready();
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    });
  });

  describe('handleEvent', () => {
    it('should process events successfully', async () => {
      (mockJetStreamService.publish as jest.Mock).mockResolvedValue({
        seq: 1,
        duplicate: false,
      });

      const events = [
        {
          eventId: '123',
          source: 'facebook' as const,
          funnelStage: 'top',
          eventType: 'click',
        },
        {
          eventId: '456',
          source: 'tiktok' as const,
          funnelStage: 'bottom',
          eventType: 'view',
        },
      ];

      const mockReq = { correlationId: 'test-correlation-id' } as Request;

      const result = await appController.handleEvent(events, mockReq);

      expect(result.status).toBe('accepted');
      expect(result.received).toBe(2);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.correlationId).toBe('test-correlation-id');

      expect(mockMetricsService.incrementEventsReceived).toHaveBeenCalledWith(
        'facebook',
        1,
      );
      expect(mockMetricsService.incrementEventsReceived).toHaveBeenCalledWith(
        'tiktok',
        1,
      );
      expect(mockMetricsService.incrementEventsPublished).toHaveBeenCalledWith(
        'facebook',
      );
      expect(mockMetricsService.incrementEventsPublished).toHaveBeenCalledWith(
        'tiktok',
      );
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle publish errors gracefully', async () => {
      const publishError = new Error('NATS publish failed');
      publishError.name = 'NatsError';

      (mockJetStreamService.publish as jest.Mock)
        .mockResolvedValueOnce({ seq: 1, duplicate: false })
        .mockRejectedValueOnce(publishError);

      const events = [
        {
          eventId: '123',
          source: 'facebook' as const,
          funnelStage: 'top',
          eventType: 'click',
        },
        {
          eventId: '456',
          source: 'tiktok' as const,
          funnelStage: 'bottom',
          eventType: 'view',
        },
      ];

      const mockReq = { correlationId: 'test-correlation-id' } as Request;

      const result = await appController.handleEvent(events, mockReq);

      expect(result.status).toBe('accepted');
      expect(result.received).toBe(2);
      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);

      expect(mockMetricsService.incrementPublishErrors).toHaveBeenCalledWith(
        'tiktok',
        'NatsError',
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should add correlation ID and timestamp to events', async () => {
      let publishedEvent: Record<string, unknown> | undefined;
      (mockJetStreamService.publish as jest.Mock).mockImplementation(
        (subject: string, event: Record<string, unknown>) => {
          publishedEvent = event;
          return Promise.resolve({ seq: 1, duplicate: false });
        },
      );

      const events = [
        {
          eventId: '123',
          source: 'facebook' as const,
          funnelStage: 'top',
          eventType: 'click',
        },
      ];

      const mockReq = { correlationId: 'test-correlation-id' } as Request;

      await appController.handleEvent(events, mockReq);

      expect(publishedEvent).toBeDefined();
      expect(publishedEvent?.correlationId).toBe('test-correlation-id');
      expect(publishedEvent?.timestamp).toBeDefined();
      expect(publishedEvent?.eventId).toBe('123');
      expect(publishedEvent?.source).toBe('facebook');
    });

    it('should publish to correct subjects based on source', async () => {
      const capturedSubjects: string[] = [];
      (mockJetStreamService.publish as jest.Mock).mockImplementation(
        (subject: string) => {
          capturedSubjects.push(subject);
          return Promise.resolve({ seq: 1, duplicate: false });
        },
      );

      const events = [
        { source: 'facebook' as const },
        { source: 'tiktok' as const },
      ];

      const mockReq = { correlationId: 'test-correlation-id' } as Request;

      await appController.handleEvent(events, mockReq);

      expect(capturedSubjects).toEqual(['events.facebook', 'events.tiktok']);
    });

    it('should handle validation warnings for invalid events', async () => {
      (mockJetStreamService.publish as jest.Mock).mockResolvedValue({
        seq: 1,
        duplicate: false,
      });

      const events: Array<{ source: string }> = [
        { source: 'invalid-source' }, // Invalid source
      ];

      const mockReq = { correlationId: 'test-correlation-id' } as Request;

      await appController.handleEvent(events as any, mockReq);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid event batch received',
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          error: expect.any(Object),
        }),
      );
    });
  });
});
