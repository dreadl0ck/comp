import { NextRequest } from 'next/server';
import { proxy } from '../../src/proxy';

const runId = process.env.E2E_RUN_ID;
const revision = process.env.E2E_REVISION;
const port = Number(process.env.E2E_PORT);
if (!runId || !revision || !Number.isInteger(port) || port < 42170 || port > 42179) {
  throw new Error('Missing run identity or invalid port');
}
if (process.env.DATABASE_URL || process.env.RESEND_API_KEY || process.env.TRIGGER_SECRET_KEY) {
  throw new Error('Ambient credentials reached fixture server');
}
const origin = `http://127.0.0.1:${port}`;
const sessions = new Set<string>();
const violations: string[] = [];
let sessionCalls = 0;

// This fake replaces only the API contract. Unexpected server fetches never leave this process.
globalThis.fetch = (async (input, init) => {
  const request = new Request(input, init);
  if (request.url !== 'http://127.0.0.1:42178/api/auth/get-session' || request.method !== 'GET') {
    violations.push(`Unexpected server fetch: ${request.method} ${new URL(request.url).pathname}`);
    throw new Error('Outbound request denied');
  }
  sessionCalls++;
  const token = readToken(request);
  return Response.json(
    sessions.has(token)
      ? {
          session: {
            id: 'session_fixture',
            token,
            userId: 'user_fixture',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
          user: {
            id: 'user_fixture',
            name: 'Synthetic Reviewer',
            email: 'reviewer@example.invalid',
          },
        }
      : null,
  );
}) as typeof fetch;
const { auth } = await import('../../src/utils/auth');

function readToken(request: Request) {
  return request.headers.get('cookie')?.match(/(?:^|;\s*)local.session_token=([^;]+)/)?.[1] || '';
}
function html(body: string) {
  return new Response(
    `<!doctype html><html><head><title>Auth contract fixture</title></head>
    <body>${body}</body></html>`,
    {
      headers: {
        'content-type': 'text/html',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'",
      },
    },
  );
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/__ready') return Response.json({ runId, revision, pid: process.pid });
    if (path === '/__ledger') return Response.json({ violations, sessionCalls });
    if (path === '/__expire' && request.method === 'POST') {
      sessions.delete(readToken(request));
      return new Response(null, { status: 204 });
    }
    if (path === '/api/auth/sign-out' && request.method === 'POST') {
      sessions.delete(readToken(request));
      return new Response(null, {
        status: 303,
        headers: {
          location: '/auth',
          'set-cookie': 'local.session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        },
      });
    }
    if (path === '/fixture/magic-link' && request.method === 'POST') {
      const token = crypto.randomUUID();
      sessions.add(token);
      return new Response(null, {
        status: 303,
        headers: {
          location: '/protected',
          'set-cookie': `local.session_token=${token}; HttpOnly; SameSite=Lax; Path=/`,
        },
      });
    }
    if (path === '/api/private') {
      const session = await auth.api.getSession({ headers: request.headers });
      return Response.json(session ? { name: session.user.name } : { error: 'Unauthorized' }, {
        status: session ? 200 : 401,
      });
    }
    if (path !== '/auth' && path !== '/protected') {
      violations.push(`Unexpected incoming route: ${request.method} ${path}`);
      return new Response('Unknown fixture route', { status: 404 });
    }
    const gate = await proxy(new NextRequest(request));
    if (gate.headers.has('location')) return gate;
    if (path === '/auth')
      return html(`<h1>Sign in (fixture)</h1>
    <form method="post" action="/fixture/magic-link"><button>Use synthetic magic link</button></form>`);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return Response.redirect(`${origin}/auth`, 303);
    return html(`<h1>Signed in as ${session.user.name}</h1>
    <form method="post" action="/api/auth/sign-out"><button>Sign out</button></form>`);
  },
});
console.log(JSON.stringify({ class: 'ui-mocked', runId, revision, port: server.port }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.stop(true);
    process.exit(0);
  });
}
