import {
  Controller,
  Get,
  Header,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiExtension,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['revision', 'sha256', 'license', 'archive'],
      properties: {
        revision: { type: 'string' },
        sha256: { type: 'string' },
        license: { type: 'string' },
        archive: { type: 'string' },
      },
    },
  })
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

  @Get('page')
  @ApiProduces('text/html')
  @ApiResponse({ status: 200, schema: { type: 'string' } })
  @ApiExtension('x-speakeasy-mcp', { disabled: true })
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'View the matching Comp source offer',
    description:
      'Authenticated source page for all roles, including portal-only users. Download matching modified source without a separate code-host account or source permission.',
  })
  async page() {
    const { revision, sha256 } = await this.readSource();
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Comp modified source</title><main style="max-width:52rem;margin:3rem auto;padding:1rem;font:18px/1.6 system-ui;overflow-wrap:anywhere"><h1>Comp modified source (AGPLv3)</h1><p>Upstream: trycompai/comp. Modified by Amsterdam Technologies. This work is provided without warranty; recipients retain the copying, modification and redistribution rights in LICENSE.</p><p><a href="/v1/source/archive">Download matching modified source</a></p><p>Revision: ${revision}</p><p>Archive SHA-256: ${sha256}</p><p>Source includes application/API/portal code, workspace dependencies, locks, build/install material, safe configuration templates, full AGPL terms and original Inter OFL terms. Independent dependency sources are identified by exact public URLs and integrity proofs. No NDA, additional role or code-host membership is required. Production environments and customer records are excluded.</p></main></html>`;
  }

  @Get('archive')
  @ApiProduces('application/gzip')
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  @ApiExtension('x-speakeasy-mcp', { disabled: true })
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
