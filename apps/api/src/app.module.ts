import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { HealthModule } from './modules/health/health.module';

/**
 * Application root.
 *
 * Domain modules (members, payments, attendance, …) are registered here as each phase
 * lands. The infrastructure modules below are global because every domain module needs
 * them; the domain modules themselves are not, and must talk to each other through
 * exported services rather than by reaching into one another's repositories.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,

    /**
     * Two tiers rather than one. A single limit generous enough for a reception desk
     * checking in a queue of members is also generous enough to be worth abusing; a
     * single limit tight enough to stop abuse breaks the reception desk. The short
     * window absorbs bursts, the long window caps sustained volume.
     *
     * Auth endpoints get their own far stricter limits when Phase 1 lands.
     */
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'burst', ttl: 1_000, limit: 20 },
        { name: 'sustained', ttl: 60_000, limit: 300 },
      ],
    }),

    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // '{*path}' rather than '*': Express 5 / path-to-regexp v8 dropped bare wildcards
    // in favour of named parameters. Nest auto-converts the legacy form but warns.
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
