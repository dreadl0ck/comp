import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceController } from './source.controller';

jest.mock('../auth/hybrid-auth.guard', () => ({
  HybridAuthGuard: class HybridAuthGuard {},
}));

it('documents actual source routes and excludes binary/HTML operations from MCP', async () => {
  const module = await Test.createTestingModule({
    controllers: [SourceController],
  }).compile();
  const app = module.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  try {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(Object.keys(document.paths)).toEqual([
      '/v1/source',
      '/v1/source/page',
      '/v1/source/archive',
    ]);
    expect(document.paths['/v1/source/page'].get?.['x-speakeasy-mcp']).toEqual({
      disabled: true,
    });
    expect(
      document.paths['/v1/source/archive'].get?.['x-speakeasy-mcp'],
    ).toEqual({ disabled: true });
    if (process.env.GEN_SOURCE_OPENAPI === '1') {
      const filename = resolve(
        __dirname,
        '../../../../packages/docs/openapi.json',
      );
      const original = JSON.parse(readFileSync(filename, 'utf8'));
      Object.assign(original.paths, document.paths);
      writeFileSync(filename, JSON.stringify(original, null, 2) + '\n');
    }
  } finally {
    await app.close();
  }
});
