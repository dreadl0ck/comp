import { expect, test } from 'bun:test';

const id = '0123456789abcdef';
const valid = `postgresql://comp_e2e:fixture@127.0.0.1:42410/comp_auth_${id}`;
const clean = { PATH: process.env.PATH, HOME: process.env.HOME };

for (const [label, change] of [
  [
    'remote host',
    { E2E_DATABASE_URL: valid.replace('127.0.0.1', 'db.example.test') },
  ],
  ['wrong port', { E2E_DATABASE_URL: valid.replace('42410', '5432') }],
  [
    'wrong database',
    { E2E_DATABASE_URL: valid.replace(`comp_auth_${id}`, 'comp') },
  ],
  ['wrong role', { E2E_DATABASE_URL: valid.replace('comp_e2e:', 'postgres:') }],
  ['extra options', { E2E_DATABASE_URL: `${valid}?schema=public` }],
  ['ambient URL', { DATABASE_URL: valid }],
] as const) {
  test(`Prisma config refuses ${label} before connection`, async () => {
    const child = Bun.spawn(
      [process.execPath, '--no-env-file', 'test/auth-local/prisma.config.ts'],
      {
        env: { ...clean, E2E_RUN_ID: id, E2E_DATABASE_URL: valid, ...change },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const error = await new Response(child.stderr).text();
    expect(await child.exited).not.toBe(0);
    expect(error).toContain('Refusing unowned auth database');
  });
}

test('runner refuses occupied API port and preserves its unrelated owner', async () => {
  const owner = Bun.serve({
    hostname: '127.0.0.1',
    port: 42411,
    fetch: () => new Response('unrelated-owner'),
  });
  try {
    const child = Bun.spawn(
      [process.execPath, '--no-env-file', 'test/auth-local/run.ts'],
      {
        env: clean,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    expect(await child.exited).not.toBe(0);
    expect(error).toContain('EADDRINUSE');
    expect(output).not.toContain('integration-local run=');
    expect(await (await fetch('http://127.0.0.1:42411')).text()).toBe(
      'unrelated-owner',
    );
  } finally {
    owner.stop(true);
  }
});
