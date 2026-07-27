import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, createPrismaClient, pingDatabase } from '@mgc/db';
import { EnvService } from '../../config/env.service';

/**
 * Owns the database connection lifecycle.
 *
 * Connects during `onModuleInit` rather than lazily on first query: a bad connection
 * string should fail the deploy at boot, while the previous release is still serving
 * traffic, not on the first request a user happens to make.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  // Not held as a property: configuration is only needed to construct the client, and
  // retaining it would invite services to reach through PrismaService for config.
  constructor(env: EnvService) {
    this.client = createPrismaClient({
      databaseUrl: env.values.DATABASE_URL,
      logQueries: env.isDevelopment,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    await pingDatabase(this.client);
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    // Released explicitly so a rolling deploy does not leave sockets held open on the
    // old instance while the new one is competing for the same connection pool.
    await this.client.$disconnect();
    this.logger.log('Database connection closed');
  }

  /** Readiness probe support: proves the server can actually answer a query. */
  async isHealthy(): Promise<boolean> {
    try {
      await pingDatabase(this.client);
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return false;
    }
  }
}
