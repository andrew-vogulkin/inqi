import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: { origin: process.env.WEB_ORIGIN ?? '*' } });
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 4000);
  console.log(`inqi backend on :${process.env.PORT ?? 4000}`);
}
bootstrap();
