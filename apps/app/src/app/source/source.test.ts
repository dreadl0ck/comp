import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './[[...path]]/route';

describe('perimeter-protected source route', () => {
  let directory: string;
  const saved = { ...process.env };
  const revision = 'a'.repeat(40);
  const archive = Buffer.from('synthetic source archive');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'comp-source-route-'));
    process.env.COMP_SOURCE_DIRECTORY = directory;
    process.env.COMP_SOURCE_REVISION = revision;
    process.env.COMP_SOURCE_SHA256 = sha256;
    writeFileSync(join(directory, `${revision}.tar.gz`), archive);
  });
  afterEach(() => {
    process.env = { ...saved };
    rmSync(directory, { recursive: true, force: true });
  });
  const request = (path?: string[]) =>
    GET(new Request('http://localhost/source'), { params: Promise.resolve({ path }) });

  it('offers a direct download without app-role or code-host checks', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('href="/source/archive"');
    expect(html).toContain(revision);
    expect(html).toContain(sha256);
    expect(html).toContain('No NDA');
  });
  it('returns exactly matching archive bytes with private caching', async () => {
    const response = await request(['archive']);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(archive);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('rejects corrupt source and unexpected subpaths', async () => {
    writeFileSync(join(directory, `${revision}.tar.gz`), 'tampered');
    expect((await request(['archive'])).status).toBe(503);
    expect((await request(['..', 'secret'])).status).toBe(404);
  });
});
