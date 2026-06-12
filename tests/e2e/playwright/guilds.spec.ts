import { expect, test } from '@playwright/test';
import { expectNoStackTrace, gotoOk } from './helpers.js';

test.describe('guild settings', () => {
  test('page loads with guild rows or a friendly empty state', async ({ page }) => {
    await gotoOk(page, '/guilds');
    await expect(page.getByText(/guild|server/i).first()).toBeVisible();

    // No real Discord connection in e2e: either rows or an honest empty
    // state are acceptable — a raw error page is not.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(
      /no (?:guilds?|servers?)|not connected|nothing|empty|none|guild|server/i
    );
    await expectNoStackTrace(page);
  });
});
