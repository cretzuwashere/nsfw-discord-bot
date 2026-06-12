import { expect, test } from '@playwright/test';
import { expectNoStackTrace, gotoOk } from './helpers.js';

test.describe('audio administration', () => {
  test.beforeEach(async ({ page }) => {
    await gotoOk(page, '/audio');
  });

  test('page loads without raw errors', async ({ page }) => {
    await expect(page.getByText(/audio/i).first()).toBeVisible();
    await expectNoStackTrace(page);
  });

  test('shows configured queue and duration limits', async ({ page }) => {
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/queue/i);
    expect(bodyText).toMatch(/duration/i);
    expect(bodyText).toMatch(/\b\d+\b/); // numeric limits (e.g. 50, 3600) are rendered
  });

  test('shows live sessions or a no-sessions empty state', async ({ page }) => {
    // No Discord token in e2e, so an empty state is the expected case.
    await expect(
      page.getByText(/session|nothing (?:is )?playing|no .*playing|idle/i).first()
    ).toBeVisible();
  });

  test('renders a recent playback errors section', async ({ page }) => {
    await expect(page.getByText(/error/i).first()).toBeVisible();
  });
});
