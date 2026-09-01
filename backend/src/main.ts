import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // ---------------------------------------------------------------- global prefix
  app.setGlobalPrefix('api');

  // ---------------------------------------------------------------- CORS
  // SECURITY: allow-list only. Never use origin: '*' together with credentials.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'https://wb.lwai.work')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Authorization'],
    maxAge: 600,
  });

  // ---------------------------------------------------------------- validation
  // whitelist  -> strips properties without decorators (anti mass-assignment)
  // forbid     -> 400 instead of silently dropping (fails loudly in dev)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidUnknownValues: true,
    }),
  );

  // ---------------------------------------------------------------- swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('lwaiwork API')
    .setDescription(
      'lwaiwork backend API (Milestone 1 skeleton).\n\n' +
        'Auth: `POST /api/auth/login` -> access (15m) + refresh (7d).\n' +
        'Send `Authorization: Bearer <access>` on protected routes.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .addTag('auth', 'Register / login / refresh / logout / me')
    .addTag('todos', 'End-to-end verification module (CRUD, per-user isolation)')
    .addTag('health', 'Liveness & readiness')
    .addTag('dashboard', 'Aggregated today snapshot (todos + habits + schedules + notes + files)')
    .addTag('analytics', 'M2-6 activity charts (per-day series + all-time summary, Redis-cached for 5 min)')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // UI:   /api/api-docs
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Raw JSON: /api-json   (consumed by codegen / CI contract checks)
  // Cast so we bind to the Express `get(path, handler)` overload rather than
  // the `get(setting)` settings overload.
  const expressApp = app.getHttpAdapter().getInstance() as unknown as {
    get: (
      path: string,
      handler: (req: unknown, res: { json: (body: unknown) => void }) => void,
    ) => void;
  };
  expressApp.get('/api-json', (_req: unknown, res: { json: (body: unknown) => void }) =>
    res.json(document),
  );

  // ---------------------------------------------------------------- shutdown hooks
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`API      http://localhost:${port}/api`);
  logger.log(`Swagger  http://localhost:${port}/api/api-docs`);
  logger.log(`OpenAPI  http://localhost:${port}/api-json`);
}

void bootstrap();
