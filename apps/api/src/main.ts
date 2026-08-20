import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseWebOrigins } from './environment';
import { join } from 'node:path';
import { RedisIoAdapter } from './redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const redisUrl = config.get<string>('REDIS_URL');
  if (redisUrl) {
    const redisAdapter = new RedisIoAdapter(app, redisUrl);
    await redisAdapter.connect();
    app.useWebSocketAdapter(redisAdapter);
  }
  const origins = parseWebOrigins(config.getOrThrow<string>('WEB_ORIGIN'));
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  if (config.get<boolean>('TRUST_PROXY')) app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({
    origin: origins,
    credentials: true,
  });
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const cookies = request.cookies as
      Record<string, string | undefined> | undefined;
    if (unsafeMethod && cookies?.vozlivre_session) {
      const origin = request.get('origin')?.replace(/\/$/, '');
      if (!origin || !origins.includes(origin)) {
        response
          .status(403)
          .json({ message: 'Origem da requisição inválida.' });
        return;
      }
    }
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}
void bootstrap();
