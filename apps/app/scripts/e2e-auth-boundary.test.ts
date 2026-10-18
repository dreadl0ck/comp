import { afterEach, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { GET as database } from '../src/app/api/auth/test-db/route';
import { POST as grant } from '../src/app/api/auth/test-grant-access/route';
import { POST as login } from '../src/app/api/auth/test-login/route';
import { proxy } from '../src/proxy';

const previousMode = process.env.E2E_TEST_MODE;
afterEach(() => {
  if (previousMode === undefined) delete process.env.E2E_TEST_MODE;
  else process.env.E2E_TEST_MODE = previousMode;
});

test('intent cannot bypass unauthenticated redirect', async () => {
  const response = await proxy(new NextRequest('http://127.0.0.1:42170/private?intent=upgrade'));
  expect(response.status).toBe(307);
  expect(new URL(response.headers.get('location')!).searchParams.get('redirectTo')).toBe(
    '/private?intent=upgrade',
  );
});
test('test header never bypasses auth even when E2E_TEST_MODE is enabled', async () => {
  process.env.E2E_TEST_MODE = 'true';
  const response = await proxy(
    new NextRequest('http://127.0.0.1:42170/private', {
      headers: { 'x-e2e-test-auth': '{"bypass":true}' },
    }),
  );
  expect(response.status).toBe(307);
});
test('authenticated intent forwards both pathname and intent without skipping rewrites', async () => {
  const response = await proxy(
    new NextRequest('http://127.0.0.1:42170/org/settings/billing/add-ons/ai?intent=upgrade', {
      headers: { cookie: '__Secure-local.session_token=synthetic' },
    }),
  );
  const rewrite = new URL(response.headers.get('x-middleware-rewrite')!);
  expect(rewrite.pathname + rewrite.search).toBe('/org/settings/billing?intent=upgrade&addOn=ai');
});
test('legacy mutation endpoints remain unavailable even with test mode enabled', () => {
  process.env.E2E_TEST_MODE = 'true';
  for (const handler of [login, grant, database]) expect(handler().status).toBe(404);
});
