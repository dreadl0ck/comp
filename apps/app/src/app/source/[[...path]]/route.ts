import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

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
    const filename = `${directory}/${revision}.tar.gz`;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    if (hash.digest('hex') !== sha256) {
      throw new Error('Source hash mismatch');
    }
    if (path[0] === 'archive') {
      const stream = createReadStream(filename);
      const iterator = stream[Symbol.asyncIterator]();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await iterator.next();
          if (done) controller.close();
          else controller.enqueue(new Uint8Array(value));
        },
        cancel() {
          stream.destroy();
        },
      });
      return new Response(body, {
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
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Comp modified source</title><main style="max-width:52rem;margin:3rem auto;padding:1rem;font:18px/1.6 system-ui;overflow-wrap:anywhere"><h1>Comp modified source</h1><p>Upstream: trycompai/comp. Modified by Amsterdam Technologies. This AGPLv3 work is provided without warranty. All users may obtain its matching app/API/portal source, workspace packages, dependency locks, covered Dub source, schemas/migrations and build/install material at no charge.</p><p><a href="/source/archive">Download matching source</a></p><p>Revision: ${revision}</p><p>Archive SHA-256: ${sha256}</p><p>LICENSE, SOURCE-BUILD.md, original supplier grants and Inter OFL terms are included. Unmodified public build inputs have exact URLs/integrity. No NDA or separate code-host account is required; recipients retain their license rights. Production credentials, user records and evidence are excluded.</p><p>API/portal users may use their existing authentication at <a href="/v1/source/page">/v1/source/page</a> or <a href="/v1/source">/v1/source</a>.</p></main></html>`,
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
