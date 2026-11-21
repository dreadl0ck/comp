import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ authenticatedPage: Page; boundary: void }>({
  boundary: [
    async ({ context, request, baseURL }, provide) => {
      const ready = await request.get('/__ready');
      expect(await ready.json()).toMatchObject({
        runId: process.env.E2E_RUN_ID,
        revision: process.env.E2E_REVISION,
      });
      const errors: string[] = [];
      context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
      await context.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin !== baseURL) {
          errors.push('Unexpected browser origin');
          await route.abort();
          return;
        }
        await route.continue();
      });
      await context.routeWebSocket(/.*/, (socket) => {
        errors.push('Unexpected browser WebSocket');
        socket.close();
      });
      await provide();
      expect(errors).toEqual([]);
      const ledger = await (await request.get('/__ledger')).json();
      expect(ledger.violations).toEqual([]);
    },
    { auto: true },
  ],
  authenticatedPage: async ({ page, request }, provide) => {
    const ready = await request.get('/__ready');
    expect(await ready.json()).toMatchObject({
      runId: process.env.E2E_RUN_ID,
      revision: process.env.E2E_REVISION,
    });
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Use synthetic magic link' }).click();
    await expect(
      page.getByRole('heading', { name: 'Signed in as Synthetic Reviewer' }),
    ).toBeVisible();
    await provide(page);
  },
});

export { expect };
