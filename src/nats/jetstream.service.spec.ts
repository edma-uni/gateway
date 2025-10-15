import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { JetStreamService } from './jetstream.service';
import { MetricsService } from '../metrics/metrics.service';

describe('JetStreamService', () => {
  let service: JetStreamService;
  let mockLogger: Partial<PinoLogger>;
  let mockMetricsService: Partial<MetricsService>;

  beforeEach(async () => {
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockMetricsService = {
      setNatsConnectionStatus: jest.fn(),
      recordNatsPublishDuration: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JetStreamService,
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
      ],
    }).compile();

    service = module.get<JetStreamService>(JetStreamService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should set logger context on construction', () => {
    expect(mockLogger.setContext).toHaveBeenCalledWith('JetStreamService');
  });

  describe('isConnected', () => {
    it('should return falsy value when connection is not initialized', () => {
      expect(service.isConnected()).toBeFalsy();
    });
  });
});
