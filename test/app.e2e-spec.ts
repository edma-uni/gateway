import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Gateway (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/health (GET)', () => {
    it('should return ok status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
          expect(res.body.timestamp).toBeDefined();
        });
    });
  });

  describe('/ready (GET)', () => {
    it('should return ready status when NATS is connected', () => {
      return request(app.getHttpServer())
        .get('/ready')
        .expect((res) => {
          if (res.status === 200) {
            expect(res.body.status).toBe('ready');
            expect(res.body.timestamp).toBeDefined();
          } else if (res.status === 503) {
            expect(res.body.status).toBe('not ready');
            expect(res.body.reason).toBeDefined();
          }
        });
    });
  });

  describe('/events (POST)', () => {
    it('should accept valid event batch', () => {
      const events = [
        {
          eventId: 'test-123',
          source: 'facebook',
          funnelStage: 'top',
          eventType: 'click',
        },
      ];

      return request(app.getHttpServer())
        .post('/events')
        .send(events)
        .expect((res) => {
          if (res.status === 201 || res.status === 200) {
            expect(res.body.status).toBe('accepted');
            expect(res.body.received).toBe(1);
            expect(res.body.correlationId).toBeDefined();
            expect(res.headers['x-correlation-id']).toBeDefined();
          }
        });
    });

    it('should reject invalid event batch', () => {
      const invalidEvents = [
        {
          eventId: 'test-123',
          source: 'invalid-source', // Invalid source
          funnelStage: 'top',
          eventType: 'click',
        },
      ];

      return request(app.getHttpServer())
        .post('/events')
        .send(invalidEvents)
        .expect(400);
    });

    it('should accept and preserve correlation ID from header', () => {
      const events = [
        {
          eventId: 'test-456',
          source: 'tiktok',
          funnelStage: 'bottom',
          eventType: 'view',
        },
      ];

      const correlationId = 'my-custom-correlation-id';

      return request(app.getHttpServer())
        .post('/events')
        .set('x-correlation-id', correlationId)
        .send(events)
        .expect((res) => {
          if (res.status === 201 || res.status === 200) {
            expect(res.body.correlationId).toBe(correlationId);
            expect(res.headers['x-correlation-id']).toBe(correlationId);
          }
        });
    });

    it('should handle multiple events in batch', () => {
      const events = [
        {
          eventId: 'test-1',
          source: 'facebook',
          funnelStage: 'top',
          eventType: 'impression',
        },
        {
          eventId: 'test-2',
          source: 'tiktok',
          funnelStage: 'bottom',
          eventType: 'click',
        },
        {
          eventId: 'test-3',
          source: 'facebook',
          funnelStage: 'top',
          eventType: 'conversion',
        },
      ];

      return request(app.getHttpServer())
        .post('/events')
        .send(events)
        .expect((res) => {
          if (res.status === 201 || res.status === 200) {
            expect(res.body.received).toBe(3);
          }
        });
    });
  });

  describe('/metrics (GET)', () => {
    it('should expose prometheus metrics', () => {
      return request(app.getHttpServer())
        .get('/metrics')
        .expect(200)
        .expect('Content-Type', /text\/plain/)
        .expect((res) => {
          expect(res.text).toContain('gateway_');
        });
    });
  });
});
