export {};

const child = Bun.spawn([process.execPath, '--no-env-file', 'e2e/focused/server.ts'], {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'production',
    E2E_TEST_MODE: 'true', // Prove even accidental production enablement cannot bypass auth.
    E2E_PORT: process.env.E2E_PORT,
    E2E_RUN_ID: process.env.E2E_RUN_ID,
    E2E_REVISION: process.env.E2E_REVISION,
    BACKEND_API_URL: 'http://127.0.0.1:42178',
  },
  stdout: 'inherit',
  stderr: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
process.exit(await child.exited);
