import 'reflect-metadata';
import { ConsoleLogger, Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { EnvService } from './config/env.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Buffered until the logger is configured, so startup errors are not lost.
    bufferLogs: true,
  });

  const env = app.get(EnvService);

  /**
   * Structured JSON logs in production so a log aggregator can index fields rather
   * than regex over prose; human-readable colour output in development. Nest 11's
   * ConsoleLogger does both, which avoids taking on pino purely for output format.
   */
  app.useLogger(
    new ConsoleLogger({
      json: env.isProduction,
      colors: !env.isProduction,
      logLevels: env.isProduction
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
    }),
  );

  const logger = new Logger('Bootstrap');

  /**
   * Security headers.
   *
   * The API serves JSON exclusively, so its CSP can be maximally restrictive: nothing
   * is allowed to load, because nothing should ever be loaded from an API response.
   * This neutralises the class of attack where a JSON endpoint is coerced into being
   * rendered as HTML. The Next.js apps carry their own, necessarily looser, nonce-based
   * policy.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      // 2 years, with preload — required for the HSTS preload list.
      hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Hides the Express fingerprint; no reason to advertise the stack.
      hidePoweredBy: true,
    }),
  );

  /**
   * CORS against an explicit allow-list from the validated environment. `credentials`
   * is on because auth uses httpOnly cookies, and the env schema refuses wildcard or
   * localhost origins in production — a wildcard origin with credentials enabled is
   * the single most common way a cookie-authenticated API is compromised.
   */
  app.enableCors({
    origin: env.values.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.useGlobalFilters(new AllExceptionsFilter(!env.isProduction));

  // URI versioning is deliberate: a gym's front-desk tablet or a member's installed
  // PWA may run an old build for weeks, so breaking changes need somewhere to live.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  /**
   * Lets Nest run onModuleDestroy hooks on SIGTERM. Without this the process is killed
   * outright on deploy: in-flight requests are dropped and database connections are
   * left for the server to time out.
   */
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || env.values.API_PORT;
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on port ${port} (${env.values.NODE_ENV})`);
  logger.log(`Health:       GET /api/v1/health/live`);
  logger.log(`Readiness:    GET /api/v1/health/ready`);
}

void bootstrap().catch((error: unknown) => {
  // Configuration and connection failures land here. Exit non-zero so the platform
  // treats the release as failed and keeps the previous version serving traffic.
  // eslint-disable-next-line no-console
  console.error('Failed to start API:', error);
  process.exit(1);
});
