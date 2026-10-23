import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { SourceController } from './source.controller';

jest.mock('../auth/hybrid-auth.guard', () => ({
  HybridAuthGuard: class HybridAuthGuard {},
}));

describe('SourceController', () => {
  let directory: string;
  const revision = 'a'.repeat(40);
  const archive = Buffer.from('synthetic matching source');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const saved = { ...process.env };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'comp-source-test-'));
    process.env.COMP_SOURCE_DIRECTORY = directory;
    process.env.COMP_SOURCE_REVISION = revision;
    process.env.COMP_SOURCE_SHA256 = sha256;
    writeFileSync(join(directory, `${revision}.tar.gz`), archive);
  });
  afterEach(() => {
    process.env = { ...saved };
    rmSync(directory, { recursive: true, force: true });
  });

  it('uses existing authentication without additional source-role requirements', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SourceController)).toEqual([
      HybridAuthGuard,
    ]);
    expect(Reflect.getMetadata('skipOrgCheck', SourceController)).toBe(true);
  });
  it('identifies the matching download', async () => {
    expect(await new SourceController().metadata()).toEqual({
      revision,
      sha256,
      license: 'AGPL-3.0',
      archive: '/v1/source/archive',
    });
  });
  it('rejects tampered source', async () => {
    writeFileSync(join(directory, `${revision}.tar.gz`), 'tampered');
    await expect(new SourceController().metadata()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
  it('rejects missing source', async () => {
    rmSync(join(directory, `${revision}.tar.gz`));
    await expect(new SourceController().metadata()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
  it('rejects an unpublished or traversal revision', async () => {
    process.env.COMP_SOURCE_REVISION = '../../credentials';
    await expect(new SourceController().metadata()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
