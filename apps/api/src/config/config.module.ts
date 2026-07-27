import { Global, Module } from '@nestjs/common';
import { EnvService } from './env.service';

/**
 * Global because configuration is a genuine cross-cutting concern — threading an
 * import of this module through all twenty-two domain modules would add noise without
 * adding a boundary anyone benefits from.
 */
@Global()
@Module({
  providers: [EnvService],
  exports: [EnvService],
})
export class ConfigModule {}
