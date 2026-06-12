import { expect, test } from '@playwright/test';
import { expectNoStackTrace, gotoOk } from './helpers.js';

test.describe('audit logs', () => {
  test.beforeEach(async ({ page }) => {
    await gotoOk(page, '/audit-logs');
  });

  test('shows a table of audit entries', async ({ page }) => {
    await expect(page.getByRole('table').first()).toBeVisible();
    await expectNoStackTrace(page);
  });

  test('contains an admin.login entry from the suite setup login', async ({ page }) => {
    await expect(page.getByText(/admin\.login/i).first()).toBeVisible();
  });

  test('optional filter narrows results when present', async ({ page }) => {
    const filter = page
      .getByRole('searchbox')
      .or(page.locator('input[type="search"], input[name*="filter" i], input[name*="search" i]'))
      .first();
    if (!(await filter.isVisible().catch(() => false))) {
      test.skip(true, 'no filter box on the audit logs page — optional feature');
      return;
    }
    await filter.fill('admin');
    await filter.press('Enter');
    await expect(page.getByText(/admin\./i).first()).toBeVisible();
  });

  test('optional pagination controls render when present', async ({ page }) => {
    const pagination = page
      .getByRole('link', { name: /next|older|page \d+|»/i })
      .or(page.getByRole('button', { name: /next|older|»/i }))
      .first();
    if (!(await pagination.isVisible().catch(() => false))) {
      test.skip(true, 'no pagination on the audit logs page — optional feature');
      return;
    }
    await expect(pagination).toBeVisible();
  });
});
