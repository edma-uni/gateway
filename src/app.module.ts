import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { NatsModule } from './nats/nats.module';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsModule } from './metrics/metrics.module';
import { LoggerModule } from 'nestjs-pino';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'SYS:standard',
                  ignore: 'pid,hostname',
                },
              }
            : undefined,
        serializers: {
          req: (req: any) => ({
            method: req.method as string,
            url: req.url as string,
            correlationId: req.correlationId as string | undefined,
          }),
          res: (res: any) => ({
            statusCode: res.statusCode as number,
          }),
        },
        customProps: (req: any) => ({
          correlationId: req.correlationId as string | undefined,
        }),
        autoLogging: {
          ignore: (req) => {
            // Don't log health checks and metrics
            return (
              req.url === '/health' ||
              req.url === '/ready' ||
              req.url === '/metrics'
            );
          },
        },
      },
    }),
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
        config: {
          prefix: 'gateway_',
        },
      },
      path: '/metrics',
      defaultLabels: {
        app: 'gateway',
        environment: process.env.NODE_ENV,
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        const required = ['NATS_URL', 'PORT'];
        for (const key of required) {
          if (!config[key]) {
            throw new Error(`Missing required env variable: ${key}`);
          }
        }
        return config;
      },
    }),
    MetricsModule,
    NatsModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
