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
      // Bounded, because an unbounded probe is a worse failure than no probe.
      // Verified against a frozen database (docker pause) rather than a stopped
      // one: a stopped container refuses the connection immediately, but a
      // hung, wedged or network-partitioned one accepts it and never answers,
      // and the bare query then blocks forever. That turned this endpoint into
      // an indefinite hang -- the monitor eventually times out and calls it
      // down, so the alert survives, but every probe holds a connection and a
      // request slot until it gives up, which is how a health check becomes
      // the thing that finishes off a struggling service.
      //
      // 5s is comfortably above normal (sub-millisecond, same host) and below
      // any sensible monitor timeout, so the 503 arrives as a real answer.
      await Promise.race([
        db.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('database probe timed out')), 5_000),
        ),
      ]);
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
