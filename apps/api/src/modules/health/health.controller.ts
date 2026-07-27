import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvService } from '../../config/env.service';

interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * Liveness: is this process running and able to respond?
   *
   * Deliberately checks nothing external. A liveness probe that fails when the database
   * is down causes the orchestrator to kill and restart every replica during a database
   * incident, turning a recoverable outage into a crash loop.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /**
   * Readiness: should this instance receive traffic?
   *
   * Checks the dependencies a request cannot succeed without. Returns 503 when unready
   * so the load balancer stops routing here while leaving the process alive to recover.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<{
    status: 'ok' | 'degraded';
    checks: Record<string, DependencyStatus>;
  }> {
    const database = await this.timed(() => this.prisma.isHealthy());
    const checks = { database };
    const healthy = Object.values(checks).every((c) => c.status === 'up');

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'degraded', checks };
  }

  /**
   * Which optional subsystems are configured on this deployment.
   *
   * Reports booleans only — never the credentials themselves, nor their length or
   * prefix, both of which narrow a brute-force search.
   */
  @Get('capabilities')
  capabilities(): Record<string, boolean> {
    return {
      payments: this.env.hasPaymentProvider,
      ai: this.env.hasAiProvider,
      supabase: Boolean(this.env.values.SUPABASE_URL),
    };
  }

  private async timed(check: () => Promise<boolean>): Promise<DependencyStatus> {
    const startedAt = performance.now();
    const up = await check();
    return {
      status: up ? 'up' : 'down',
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
