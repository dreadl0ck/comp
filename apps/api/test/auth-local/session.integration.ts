import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { render } from '@react-email/render';
import { chromium, type Browser } from 'playwright-core';
import { LocalClient } from './http-client';
import { loginHelpers } from './login';
import type { ReactElement } from 'react';
import './prisma.config';

// Only startup dotenv and outbound mail are replaced; auth, hooks and DB stay real.
mock.module('../../src/config/load-env', () => ({ ensureEnvLoaded() {} }));
const mail: { to: string; html: string }[] = [];
mock.module('../../src/email/trigger-email', () => ({
  triggerEmail: async (params: { to: string; react: ReactElement }) => {
    if (!params.to.endsWith('@example.test'))
      throw new Error('Non-fixture mail recipient');
    mail.push({ to: params.to, html: await render(params.react) });
    return { id: `local-${mail.length}` };
  },
}));
if (process.env.DATABASE_URL)
  throw new Error('Ambient DATABASE_URL is forbidden');
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
const violations: string[] = [];
globalThis.fetch = (() => {
  violations.push('Unexpected server fetch');
  throw new Error('Outbound server fetch forbidden in auth-local');
}) as typeof fetch;
const { auth } = await import('../../src/auth/auth.server');
const { db } = await import('../../prisma');
const origin = process.env.BASE_URL!;
let server: ReturnType<typeof Bun.serve>;
let browser: Browser;
const clients: LocalClient[] = [];
async function shutdown() {
  await browser?.close();
  await Promise.all(clients.map((context) => context.dispose()));
  server?.stop(true);
  await db.$disconnect();
}
process.once('SIGTERM', () => {
  void Promise.race([shutdown(), Bun.sleep(3000)]).finally(() =>
    process.exit(143),
  );
});

async function client() {
  const context = new LocalClient(origin);
  clients.push(context);
  return context;
}

const { magic, otp, session } = loginHelpers({ origin, mail, client });

beforeAll(async () => {
  const rows = await db.$queryRaw<{ db: string; owner: string }[]>`
    SELECT current_database() AS db, shobj_description(oid, 'pg_database') AS owner
    FROM pg_database WHERE datname = current_database()`;
  expect(rows[0]).toEqual({
    db: `comp_auth_${process.env.E2E_RUN_ID}`,
    owner: `${process.env.E2E_RUN_ID}:${process.env.E2E_REVISION}`,
  });
  expect(auth.options.emailAndPassword?.enabled).toBe(false);
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 42411,
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path.startsWith('/api/auth/')) return auth.handler(req);
      if (path === '/__ready')
        return Response.json({
          run: process.env.E2E_RUN_ID,
          revision: process.env.E2E_REVISION,
        });
      if (path === '/')
        return new Response('<!doctype html><title>Local auth seam</title>', {
          headers: { 'content-type': 'text/html' },
        });
      return new Response('', { status: 404 });
    },
  });
  const probe = await client();
  expect(await (await probe.get('/__ready')).json()).toEqual({
    run: process.env.E2E_RUN_ID,
    revision: process.env.E2E_REVISION,
  });
  const password = await probe.post('/api/auth/sign-in/email', {
    data: { email: 'disabled@example.test', password: 'never-enabled' },
  });
  expect(password.status()).toBe(400);
  expect((await password.json()).code).toBe('EMAIL_PASSWORD_DISABLED');
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await shutdown();
  expect(violations).toEqual([]);
});

test('magic link creates a database session; browser reload persists it; logout rejects cookie and link replay', async () => {
  const email = 'magic@example.test';
  const login = await magic(email);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    violations.push('Unexpected browser origin');
    return route.abort();
  });
  await context.routeWebSocket('**/*', (socket) => {
    violations.push('Unexpected browser WebSocket');
    socket.close();
  });
  const page = await context.newPage();
  page.on('pageerror', () => violations.push('Browser page error'));
  await page.goto(login.url);
  expect(page.url()).toBe(`${origin}/`);
  const cookies = await context.cookies();
  const cookie = cookies.find(
    (cookie) => cookie.name === 'local.session_token',
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  const readSession = () =>
    page.evaluate(async () => (await fetch('/api/auth/get-session')).json());
  const first = await readSession();
  expect(first.user.email).toBe(email);
  expect(first.user.id).toMatch(/^usr_/);
  expect(first.session.id).toMatch(/^ses_/);
  expect(await db.session.count({ where: { id: first.session.id } })).toBe(1);
  await page.reload();
  expect((await readSession()).session.id).toBe(first.session.id);
  expect(await session(await client())).toBeNull();
  const replay = await client();
  const oldCookie = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  expect(
    await page.evaluate(
      async () =>
        (
          await fetch('/api/auth/sign-out', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
    ),
  ).toBe(200);
  expect(await readSession()).toBeNull();
  expect(await db.session.count({ where: { id: first.session.id } })).toBe(0);
  expect(
    await (
      await replay.get(`${origin}/api/auth/get-session`, {
        headers: { cookie: oldCookie },
      })
    ).json(),
  ).toBeNull();
  const reused = await replay.get(login.url, { maxRedirects: 0 });
  expect(reused.status()).toBe(302);
  expect(reused.headers().location).toContain('error=');
  expect(await session(replay)).toBeNull();
  await context.close();
});

test('email OTP rejects wrong/replayed codes; server expiry rejects a still-present signed cookie', async () => {
  const email = 'otp@example.test';
  const { context, code } = await otp(email);
  const live = await session(context);
  expect(live.user.email).toBe(email);
  const outsider = await client();
  for (const otp of ['invalid', code]) {
    expect(
      (
        await outsider.post(`${origin}/api/auth/sign-in/email-otp`, {
          data: { email, otp },
        })
      ).status(),
    ).toBe(400);
    expect(await session(outsider)).toBeNull();
  }
  const state = await context.storageState();
  expect(
    state.cookies.some((cookie) => cookie.name === 'local.session_token'),
  ).toBe(true);
  await db.session.update({
    where: { id: live.session.id },
    data: { expiresAt: new Date(0) },
  });
  expect(await session(context)).toBeNull();
  const replay = await client();
  expect(
    await (
      await replay.get(`${origin}/api/auth/get-session`, {
        headers: {
          cookie: state.cookies
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join('; '),
        },
      })
    ).json(),
  ).toBeNull();
  const expired = await magic('expired-link@example.test');
  const token = new URL(expired.url).searchParams.get('token');
  expect(token).toBeTruthy();
  expect(
    (
      await db.verification.updateMany({
        where: { identifier: token! },
        data: { expiresAt: new Date(0) },
      })
    ).count,
  ).toBe(1);
  const refused = await expired.context.get(expired.url, { maxRedirects: 0 });
  expect(refused.status()).toBe(302);
  expect(refused.headers().location).toContain('error=');
  expect(await session(expired.context)).toBeNull();
});

test('independent organizations deny foreign reads/switches and persist BetterAuth fail-closed scope', async () => {
  const a = (await otp('tenant-a@example.test')).context;
  const b = (await otp('tenant-b@example.test')).context;
  async function create(context: LocalClient, slug: string) {
    const response = await context.post(
      `${origin}/api/auth/organization/create`,
      { data: { name: slug, slug } },
    );
    expect(response.status()).toBe(200);
    return response.json();
  }
  const orgA = await create(a, 'local-a');
  const orgB = await create(b, 'local-b');
  expect(orgA.id).not.toBe(orgB.id);
  for (const [context, own, foreign] of [
    [a, orgA, orgB],
    [b, orgB, orgA],
  ] as const) {
    expect(
      (
        await context.post(`${origin}/api/auth/organization/set-active`, {
          data: { organizationId: own.id },
        })
      ).status(),
    ).toBe(200);
    expect((await session(context)).session.activeOrganizationId).toBe(own.id);
    const forbidden = await context.get(
      `${origin}/api/auth/organization/get-full-organization?organizationId=${foreign.id}`,
    );
    expect(forbidden.status()).toBe(403);
    expect(JSON.stringify(await forbidden.json())).not.toContain(foreign.name);
    expect(
      (
        await context.post(`${origin}/api/auth/organization/set-active`, {
          data: { organizationId: foreign.id },
        })
      ).status(),
    ).toBe(403);
    const current = await session(context);
    // BetterAuth clears the active selection on membership denial (crud-org.mjs).
    expect(current.session.activeOrganizationId).toBeNull();
    expect(
      (
        await db.session.findUniqueOrThrow({
          where: { id: current.session.id },
        })
      ).activeOrganizationId,
    ).toBeNull();
    expect(
      await db.member.count({
        where: { userId: current.user.id, organizationId: foreign.id },
      }),
    ).toBe(0);
    expect(
      (
        await context.get(
          `${origin}/api/auth/organization/get-full-organization?organizationId=${own.id}`,
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await context.post(`${origin}/api/auth/organization/set-active`, {
          data: { organizationId: own.id },
        })
      ).status(),
    ).toBe(200);
    expect((await session(context)).session.activeOrganizationId).toBe(own.id);
    const relogin = (await otp(current.user.email)).context;
    const restored = await session(relogin);
    expect(restored.session.id).not.toBe(current.session.id);
    expect(restored.session.activeOrganizationId).toBe(own.id);
  }
});
