import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { SkipOrgCheck } from '../auth/skip-org-check.decorator';

@ApiTags('Source')
@Controller({ path: 'source', version: '1' })
@UseGuards(HybridAuthGuard)
@SkipOrgCheck()
export class SourceController {
  private async readSource() {
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
      const filename = `${directory}/${revision}.tar.gz`;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(filename)) hash.update(chunk);
      if (hash.digest('hex') !== sha256) {
        throw new Error('Source hash mismatch');
      }
      return { revision, sha256, filename };
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
  async metadata() {
    const { revision, sha256 } = await this.readSource();
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
  async download(@Res({ passthrough: true }) response: Response) {
    const { revision, sha256, filename } = await this.readSource();
    response.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="comp-${revision}.tar.gz"`,
      'Cache-Control': 'private, no-store',
      'X-Source-Revision': revision,
      'X-Source-SHA256': sha256,
    });
    return new StreamableFile(createReadStream(filename));
  }
}
