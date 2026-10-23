import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const dynamic = 'force-dynamic';

// This route is protected by the existing comp-gate perimeter, not app RBAC.
export async function GET(_request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  if (path.length > 1 || (path.length === 1 && path[0] !== 'archive')) {
    return new Response('Not found', { status: 404 });
  }
  const revision = process.env.COMP_SOURCE_REVISION;
  const sha256 = process.env.COMP_SOURCE_SHA256;
  if (!revision?.match(/^[0-9a-f]{40}$/) || !sha256?.match(/^[0-9a-f]{64}$/)) {
    return new Response('Matching source has not been published', { status: 503 });
  }
  try {
    const directory = process.env.COMP_SOURCE_DIRECTORY || '/opt/comp-source';
    const archive = readFileSync(`${directory}/${revision}.tar.gz`);
    if (createHash('sha256').update(archive).digest('hex') !== sha256) {
      throw new Error('Source hash mismatch');
    }
    if (path[0] === 'archive') {
      return new Response(new Uint8Array(archive), {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="comp-${revision}.tar.gz"`,
          'Cache-Control': 'private, no-store',
          'X-Source-Revision': revision,
          'X-Source-SHA256': sha256,
        },
      });
    }
    return new Response(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Comp modified source</title><main style="max-width:52rem;margin:3rem auto;padding:1rem;font:18px/1.6 system-ui;overflow-wrap:anywhere"><h1>Comp modified source</h1><p>This service runs a modified AGPLv3 Comp fork. All users may obtain its matching source, workspace packages, dependency locks, schemas/migrations and build/install material at no charge.</p><p><a href="/source/archive">Download matching source</a></p><p>Revision: ${revision}</p><p>Archive SHA-256: ${sha256}</p><p>LICENSE and SOURCE-BUILD.md are included. No NDA or separate code-host account is required; recipients retain their license rights. Production credentials, user records and evidence are excluded.</p><p>API callers may use their existing credentials at <a href="/v1/source">/v1/source</a> and /v1/source/archive.</p></main></html>`,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch {
    return new Response('Matching source is unavailable', { status: 503 });
  }
}
