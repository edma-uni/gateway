import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppController } from './app.controller';
import { JetStreamService } from './nats/jetstream.service';
import { MetricsService } from './metrics/metrics.service';
import type { Request } from 'express';
import type { EventBatch } from './types/event.types';

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
      (mockJetStreamService.publish as jest.Mock).mockResolvedValue({});

      const events: EventBatch = [
        {
          eventId: '123',
          source: 'facebook',
          funnelStage: 'top',
          eventType: 'click',
        },
        {
          eventId: '456',
          source: 'tiktok',
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

      expect(mockMetricsService.incrementEventsReceived).toHaveBeenCalledTimes(
        2,
      );
      expect(mockMetricsService.incrementEventsPublished).toHaveBeenCalledTimes(
        2,
      );
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle publish errors gracefully', async () => {
      (mockJetStreamService.publish as jest.Mock)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('NATS publish failed'));

      const events: EventBatch = [
        {
          eventId: '123',
          source: 'facebook',
          funnelStage: 'top',
          eventType: 'click',
        },
        {
          eventId: '456',
          source: 'tiktok',
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

      expect(mockMetricsService.incrementPublishErrors).toHaveBeenCalledTimes(
        1,
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should add correlation ID and timestamp to events', async () => {
      let publishedEvent: any;
      (mockJetStreamService.publish as jest.Mock).mockImplementation(
        (subject: string, event: any) => {
          publishedEvent = event;
          return Promise.resolve({});
        },
      );

      const events: EventBatch = [
        {
          eventId: '123',
          source: 'facebook',
          funnelStage: 'top',
          eventType: 'click',
        },
      ];

      const mockReq = { correlationId: 'test-correlation-id' } as Request;

      await appController.handleEvent(events, mockReq);

      expect(publishedEvent.correlationId).toBe('test-correlation-id');
      expect(publishedEvent.timestamp).toBeDefined();
    });
  });
});
