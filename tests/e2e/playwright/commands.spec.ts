import { expect, test } from '@playwright/test';
import { expectNoSecretsRendered, expectNoStackTrace, gotoOk } from './helpers.js';

test.describe('commands documentation page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoOk(page, '/commands');
  });

  test('lists audio and moderation commands', async ({ page }) => {
    await expect(page.getByText('/play url:<link>').first()).toBeVisible();
    await expect(page.getByText('/controls').first()).toBeVisible();
    await expect(page.getByText('Moderation').first()).toBeVisible();
    await expectNoStackTrace(page);
  });

  test('does not leak secrets', async ({ page }) => {
    await expectNoSecretsRendered(page);
  });
});
