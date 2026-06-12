import { expect, test } from '@playwright/test';
import { gotoOk } from './helpers.js';

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await gotoOk(page, '/dashboard');
  });

  test('shows the Discord adapter with a connection state', async ({ page }) => {
    await expect(page.getByText(/discord/i).first()).toBeVisible();
    // E2E runs without a real Discord token, so any honest state is fine.
    await expect(
      page
        .getByText(/connected|connecting|disabled|disconnected|offline|unreachable|error/i)
        .first()
    ).toBeVisible();
  });

  test('shows database status as healthy', async ({ page }) => {
    await expect(page.getByText(/database/i).first()).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/\b(?:ok|healthy|connected|up)\b/i);
  });

  test('lists the built-in modules', async ({ page }) => {
    await expect(page.getByText('Audio Player').first()).toBeVisible();
    await expect(page.getByText(/Moderation/).first()).toBeVisible();
  });

  test('shows environment and version', async ({ page }) => {
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/development|test|production/i);
    expect(bodyText).toMatch(/\d+\.\d+\.\d+/); // BUILD_VERSION, e.g. 0.1.0
  });

  test('has a recent audit logs section', async ({ page }) => {
    await expect(page.getByText(/audit/i).first()).toBeVisible();
  });
});
