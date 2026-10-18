import { expect } from 'bun:test';
import type { LocalClient } from './http-client';

export function loginHelpers({
  origin,
  mail,
  client,
}: {
  origin: string;
  mail: { to: string; html: string }[];
  client: () => Promise<LocalClient>;
}) {
  function message(email: string) {
    const item = mail.findLast((item) => item.to === email);
    if (!item) throw new Error('Auth failed to emit mail');
    return item.html;
  }
  async function session(context: LocalClient) {
    const response = await context.get(`${origin}/api/auth/get-session`);
    expect(response.status()).toBe(200);
    return response.json();
  }
  async function magic(email: string) {
    const context = await client();
    const response = await context.post(
      `${origin}/api/auth/sign-in/magic-link`,
      {
        data: { email, name: 'Local fixture', callbackURL: `${origin}/` },
      },
    );
    expect(response.status()).toBe(200);
    const hrefs = [...message(email).matchAll(/href="([^"]+)"/g)].map((match) =>
      match[1].replaceAll('&amp;', '&'),
    );
    const url = hrefs.find((url) =>
      url.startsWith(`${origin}/api/auth/magic-link/verify?`),
    );
    if (!url)
      throw new Error('No actual BetterAuth verify URL in rendered mail');
    return { context, url };
  }
  async function otp(email: string) {
    const context = await client();
    const sent = await context.post(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        data: { email, type: 'sign-in' },
      },
    );
    expect(sent.status()).toBe(200);
    const code = message(email).match(/\b\d{6}\b/)?.[0];
    if (!code) throw new Error('No OTP in rendered mail');
    const wrong = code === '000000' ? '111111' : '000000';
    const rejected = await context.post(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        data: { email, otp: wrong },
      },
    );
    expect(rejected.status()).toBe(400);
    expect(await session(context)).toBeNull();
    const response = await context.post(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        data: { email, otp: code },
      },
    );
    expect(response.status()).toBe(200);
    return { context, code };
  }
  return { session, magic, otp };
}
