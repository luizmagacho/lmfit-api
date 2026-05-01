import { UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { BrlMoneyResponseInterceptor } from './common/money/brl-money-response.interceptor';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // Allow browsers on :3000 to load images served from :4000/uploads/*.
  // Must come BEFORE helmet so the header is not overwritten.
  app.use('/uploads', (_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(cookieParser());
  app.useGlobalInterceptors(new BrlMoneyResponseInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => {
        const messages = errors.flatMap((e) =>
          Object.values(e.constraints ?? {}),
        );
        return new UnprocessableEntityException({
          message:
            messages.length <= 1
              ? (messages[0] ?? 'Validation failed')
              : messages,
        });
      },
    }),
  );
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  const extraOrigins = (process.env.WEB_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [
      webOrigin,
      ...extraOrigins,
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    ],
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Requested-With',
      'Cookie',
    ],
    exposedHeaders: ['Content-Disposition'],
  });

  const config = new DocumentBuilder()
    .setTitle('LM FIT Control API')
    .setDescription('Purchases, invoices, orders, customers, suppliers, users')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.LISTEN_HOST ?? '0.0.0.0';
  await app.listen(port, host);
}
bootstrap();
