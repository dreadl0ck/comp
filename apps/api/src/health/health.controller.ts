import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { db } from '@db';

@ApiTags('Health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Health check',
    description: 'Returns the health status of the API',
  })
  @ApiResponse({
    status: 200,
    description: 'API is healthy',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'ok',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
            uptime: {
              type: 'number',
              description: 'Process uptime in seconds',
            },
            version: {
              type: 'string',
              example: '1.0.0',
            },
            database: {
              type: 'string',
              example: 'ok',
              description: 'Result of a live SELECT against Postgres',
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'API is up but a dependency is unreachable',
  })
  // AT-PATCH: upstream returns {"status":"ok"} unconditionally, touching
  // nothing. A liveness probe that cannot fail is not a health check -- it
  // reports healthy with Postgres down, which is the exact case a monitor
  // exists to catch, and it means an uptime dashboard reads green through a
  // total outage.
  //
  // Now issues a real query. Kuma asserts on "database":"ok" rather than
  // "status":"ok" because that names the dependency; a container that is up
  // and cannot reach its database is the failure worth alerting on, and it is
  // indistinguishable from healthy at the process level.
  //
  // 503 rather than a 200 carrying an error field: status code is what every
  // probe, load balancer and orchestrator reads without parsing a body.
  @HttpCode(200)
  async getHealth() {
    const base = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
    };

    try {
      await db.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok', ...base };
    } catch {
      // Deliberately not rethrowing: a health endpoint that 500s with a stack
      // trace tells an unauthenticated caller more about the deployment than
      // it needs to. The status code carries the signal.
      throw new ServiceUnavailableException({
        status: 'degraded',
        database: 'error',
        ...base,
      });
    }
  }
}
