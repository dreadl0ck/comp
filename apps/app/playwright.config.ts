import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const port = process.env.E2E_PORT || '42170';
if (!/^4217[0-9]$/.test(port)) throw new Error('E2E_PORT must be in 42170-42179');
const runId = process.env.E2E_RUN_ID || randomBytes(8).toString('hex');
if (!/^[a-f0-9]{16}$/.test(runId))
  throw new Error('E2E_RUN_ID must be 16 lowercase hex characters');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
process.env.E2E_RUN_ID = runId;
process.env.E2E_REVISION = revision;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e/focused',
  testMatch: '**/*.spec.ts',
  outputDir: `test-results/${runId}`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 20_000,
  globalTimeout: 120_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'ui-mocked-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun --no-env-file e2e/focused/launch.ts',
    url: `${baseURL}/__ready`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: { E2E_PORT: port, E2E_RUN_ID: runId, E2E_REVISION: revision },
  },
});
