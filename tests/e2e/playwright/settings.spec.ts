import { expect, test } from '@playwright/test';
import { expectNoSecretsRendered, expectNoStackTrace, gotoOk } from './helpers.js';

test.describe('system settings', () => {
  test('page loads and shows environment values', async ({ page }) => {
    await gotoOk(page, '/settings');
    await expect(page.getByText(/settings|system/i).first()).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/environment|development|test|production/i);
    await expectNoStackTrace(page);
  });

  test('never renders secret values on any admin page', async ({ page }) => {
    // SESSION_SECRET, INTERNAL_API_TOKEN, ADMIN_PASSWORD, E2E_ADMIN_PASSWORD
    // and POSTGRES_PASSWORD must not leak into HTML on ANY page.
    for (const path of ['/settings', '/dashboard', '/modules', '/audio', '/audit-logs']) {
      await gotoOk(page, path);
      await expectNoSecretsRendered(page);
    }
  });
});
