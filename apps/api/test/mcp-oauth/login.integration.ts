import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  auth,
  authorization,
  config,
  exchange,
  mail,
  request,
  setupFixture,
  teardownFixture,
} from './helpers';

beforeAll(setupFixture);
afterAll(teardownFixture);

function postJson(path: string, data: Record<string, string>, cookie = '') {
  return auth.handler(
    new Request(config.issuer + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: new URL(config.issuer).origin,
        cookie,
      },
      body: JSON.stringify(data),
    }),
  );
}

const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

test('magic link creates a real session and rejects replay; logout invalidates its cookie', async () => {
  const email = 'magic-login@example.test';
  expect(
    (
      await postJson('/sign-in/magic-link', {
        email,
        name: 'Owned login',
        callbackURL: config.loginPage,
      })
    ).status,
  ).toBe(200);
  const html = mail.findLast((item) => item.to === email)?.html || '';
  const url = [...html.matchAll(/href="([^"]+)"/g)]
    .map((match) => match[1].replaceAll('&amp;', '&'))
    .find((url) => url.startsWith(config.issuer + '/magic-link/verify?'));
  if (!url)
    throw new Error(
      'Expected actual verification link in captured fixture email',
    );
  const verified = await auth.handler(new Request(url));
  expect(verified.status).toBe(302);
  const cookie = cookies(verified);
  expect(
    verified.headers.getSetCookie().some((value) => value.includes('HttpOnly')),
  ).toBe(true);
  const headers = new Headers({ cookie });
  expect((await auth.api.getSession({ headers }))?.user.email).toBe(email);
  const replay = await auth.handler(new Request(url));
  expect(replay.headers.get('location')).toContain('error=');
  expect((await postJson('/sign-out', {}, cookie)).status).toBe(200);
  expect(await auth.api.getSession({ headers })).toBeNull();
});

test('email OTP rejects wrong and replayed codes while successful sign-in creates a real session', async () => {
  const email = 'otp-login@example.test';
  expect(
    (
      await postJson('/email-otp/send-verification-otp', {
        email,
        type: 'sign-in',
      })
    ).status,
  ).toBe(200);
  const otp = mail
    .findLast((item) => item.to === email)
    ?.html.match(/\b\d{6}\b/)?.[0];
  if (!otp) throw new Error('Expected actual code in captured fixture email');
  expect(
    (
      await postJson('/sign-in/email-otp', {
        email,
        otp: otp === '000000' ? '111111' : '000000',
      })
    ).status,
  ).toBe(400);
  const success = await postJson('/sign-in/email-otp', { email, otp });
  expect(success.status).toBe(200);
  expect(
    (
      await auth.api.getSession({
        headers: new Headers({ cookie: cookies(success) }),
      })
    )?.user.email,
  ).toBe(email);
  expect((await postJson('/sign-in/email-otp', { email, otp })).status).toBe(
    400,
  );
});

test('an OAuth authorization code cannot be redeemed as a magic-link token', async () => {
  const { code, verifier } = await authorization();
  const response = await request(
    '/api/auth/magic-link/verify?' +
      new URLSearchParams({ token: code, callbackURL: config.loginPage }),
  );
  expect(response.headers.get('location')).toContain('error=');
  expect(
    await auth.api.getSession({
      headers: new Headers({ cookie: cookies(response) }),
    }),
  ).toBeNull();
  expect((await exchange(code, verifier)).status).toBe(200);
});
