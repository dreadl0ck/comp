import { expect, test } from '../fixtures/auth';

test('unauthenticated intent and forged bypass header cannot open protected UI', async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ 'x-e2e-test-auth': '{"bypass":true}' });
  await page.goto('/protected?intent=upgrade');
  await expect(page).toHaveURL(/\/auth\?.*redirectTo=/);
  await expect(page.getByRole('heading', { name: 'Sign in (fixture)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Signed in/ })).toHaveCount(0);
});

test('cookie persists across reload, isolates contexts, and logout invalidates replay', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Use synthetic magic link' }).click();
  await expect(
    page.getByRole('heading', { name: 'Signed in as Synthetic Reviewer' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Signed in as/ })).toBeVisible();
  const cookie = (await page.context().cookies()).find(
    (entry) => entry.name === 'local.session_token',
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  const other = await browser.newContext({ baseURL });
  try {
    expect((await other.request.get('/api/private')).status()).toBe(401);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/auth$/);
    expect(
      (await page.context().cookies()).some((entry) => entry.name === 'local.session_token'),
    ).toBe(false);
    const replay = await other.request.get('/api/private', {
      headers: {
        cookie: `${cookie?.name}=${cookie?.value}`,
      },
    });
    expect(replay.status()).toBe(401);
    await expect(replay.json()).resolves.toEqual({ error: 'Unauthorized' });
  } finally {
    await other.close();
  }
});

test('server-side expiry rejects a still-present cookie on reload and API access', async ({
  authenticatedPage: page,
}) => {
  const before = await page.context().cookies();
  expect((await page.request.post('/__expire')).status()).toBe(204);
  expect(await page.context().cookies()).toEqual(before);
  expect((await page.request.get('/api/private')).status()).toBe(401);
  await page.reload();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole('heading', { name: 'Sign in (fixture)' })).toBeVisible();
});
