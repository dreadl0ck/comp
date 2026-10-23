import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Response } from 'express';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { SkipOrgCheck } from '../auth/skip-org-check.decorator';

@ApiTags('Source')
@Controller({ path: 'source', version: '1' })
@UseGuards(HybridAuthGuard)
@SkipOrgCheck()
export class SourceController {
  private readSource() {
    const revision = process.env.COMP_SOURCE_REVISION;
    const sha256 = process.env.COMP_SOURCE_SHA256;
    if (
      !revision?.match(/^[0-9a-f]{40}$/) ||
      !sha256?.match(/^[0-9a-f]{64}$/)
    ) {
      throw new ServiceUnavailableException(
        'Matching source has not been published',
      );
    }
    try {
      const directory = process.env.COMP_SOURCE_DIRECTORY || '/opt/comp-source';
      const archive = readFileSync(`${directory}/${revision}.tar.gz`);
      if (createHash('sha256').update(archive).digest('hex') !== sha256) {
        throw new Error('Source hash mismatch');
      }
      return { revision, sha256, archive };
    } catch {
      throw new ServiceUnavailableException('Matching source is unavailable');
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Get matching modified Comp source',
    description:
      'All authenticated users may obtain the deployed modified AGPL source without an additional role, NDA or repository access. Download using the same authentication at /v1/source/archive.',
  })
  metadata() {
    const { revision, sha256 } = this.readSource();
    return {
      revision,
      sha256,
      license: 'AGPL-3.0',
      archive: '/v1/source/archive',
    };
  }

  @Get('archive')
  @ApiOperation({
    summary: 'Download matching modified Comp source',
    description:
      'Download the full corresponding modified Comp source using existing session, API-key or service-token authentication. No additional source permission is required.',
  })
  download(@Res() response: Response) {
    const { revision, sha256, archive } = this.readSource();
    response.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="comp-${revision}.tar.gz"`,
      'Cache-Control': 'private, no-store',
      'X-Source-Revision': revision,
      'X-Source-SHA256': sha256,
    });
    response.send(archive);
  }
}
