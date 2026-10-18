import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const runtime = { PATH: process.env.PATH, HOME: process.env.HOME };

test('setup refuses ambient DATABASE_URL without explicit disposable configuration', async () => {
  const child = Bun.spawn([process.execPath, '--no-env-file', 'scripts/setup-e2e.ts', '--check'], {
    cwd,
    env: { ...runtime, DATABASE_URL: 'postgresql://never-connect.invalid/customer' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await child.exited).not.toBe(0);
  expect(await new Response(child.stdout).text()).not.toContain('Validated');
});

test('check-only validates explicit configuration without contacting even an absent database', async () => {
  const child = Bun.spawn([process.execPath, '--no-env-file', 'scripts/setup-e2e.ts', '--check'], {
    cwd,
    env: {
      ...runtime,
      E2E_RUN_ID: '0123456789abcdef',
      E2E_DATABASE_URL:
        'postgresql://comp_e2e:fixture@127.0.0.1:42179/comp_e2e_0123456789abcdef?schema=e2e_0123456789abcdef',
      DATABASE_URL: 'postgresql://never-connect.invalid/customer',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toContain('no connection made');
});

test('fixture refuses a port collision and leaves the existing owner alive', async () => {
  const owner = Bun.serve({
    hostname: '127.0.0.1',
    port: 42171,
    fetch: () => new Response('original owner'),
  });
  try {
    const child = Bun.spawn([process.execPath, '--no-env-file', 'e2e/focused/launch.ts'], {
      cwd,
      env: {
        ...runtime,
        E2E_PORT: '42171',
        E2E_RUN_ID: '0123456789abcdef',
        E2E_REVISION: 'fixture-revision',
        DATABASE_URL: 'poison',
        RESEND_API_KEY: 'poison',
        TRIGGER_SECRET_KEY: 'poison',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await child.exited).not.toBe(0);
    const errors = await new Response(child.stderr).text();
    expect(errors).toMatch(/EADDRINUSE|port.*in use/i);
    expect(errors).not.toContain('Ambient credentials');
    expect(await (await fetch('http://127.0.0.1:42171')).text()).toBe('original owner');
  } finally {
    owner.stop(true);
  }
});
