import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from './infra/config/config.service';
import { DomainExceptionFilter, ErrorEnvelopeDto } from './common/errors';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.enableCors({ origin: config.webOrigins, credentials: true });
  app.setGlobalPrefix('api');

  // DTOs everywhere: strip unknown props, reject non-whitelisted, coerce types.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // AI-readable errors: every failure → the standard { error: { code, message, retryable, details } } envelope.
  app.useGlobalFilters(new DomainExceptionFilter());
  // Request logging.
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger — every endpoint + DTO renders at /api/docs.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('inqi API')
    .setDescription('AI-driven inquiry & research workflow')
    .setVersion('0.1.0')
    .addTag('public').addTag('auth').addTag('capability-token').addTag('webhooks').addTag('observability')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig, { extraModels: [ErrorEnvelopeDto] });
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(config.port);
  Logger.log(`inqi backend on :${config.port} (docs at /api/docs)`, 'Bootstrap');
}
bootstrap();
