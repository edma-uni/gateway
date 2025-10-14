import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NatsModule } from './nats/nats.module';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
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
  providers: [AppService],
})
export class AppModule {}
