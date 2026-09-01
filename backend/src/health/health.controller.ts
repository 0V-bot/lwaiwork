import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly redis: RedisService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe (no auth required)' })
  liveness(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: also verifies Redis reachability.
   * Returns 503-compatible payload but a 200 status so the Docker healthcheck
   * stays simple; ops dashboards should read the `status` field.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe: checks Redis connectivity' })
  async readiness(): Promise<{
    status: 'ok' | 'degraded';
    redis: 'up' | 'down';
    timestamp: string;
  }> {
    let redis: 'up' | 'down' = 'down';
    try {
      redis = (await this.redis.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      redis = 'down';
    }

    return {
      status: redis === 'up' ? 'ok' : 'degraded',
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}
