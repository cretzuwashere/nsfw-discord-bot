import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { gotoOk } from './helpers.js';

/** Innermost container (row/card/form) that holds the given module name. */
function moduleRow(page: Page, moduleName: string): Locator {
  return page
    .locator('tr, li, article, form, section')
    .filter({ hasText: moduleName })
    .last();
}

interface ToggleControl {
  control: Locator;
  enabled: boolean;
  kind: 'button' | 'checkbox';
}

/**
 * Resolve the enable/disable control for a module row. Server-rendered
 * admin panels usually expose a button labelled with the OPPOSITE action
 * ("Disable" while enabled); a checkbox/switch is supported as fallback.
 * Note /enable/i does not match "Disable" (no 'n'), so the two are disjoint.
 */
async function resolveToggle(row: Locator): Promise<ToggleControl | null> {
  const disableButton = row.getByRole('button', { name: /disable/i }).first();
  if (await disableButton.isVisible().catch(() => false)) {
    return { control: disableButton, enabled: true, kind: 'button' };
  }
  const enableButton = row.getByRole('button', { name: /enable/i }).first();
  if (await enableButton.isVisible().catch(() => false)) {
    return { control: enableButton, enabled: false, kind: 'button' };
  }
  const checkbox = row.getByRole('checkbox').or(row.getByRole('switch')).first();
  if (await checkbox.isVisible().catch(() => false)) {
    // .catch: the poll below may race a server-rendered page reload.
    const checked = await checkbox.isChecked().catch(() => false);
    return { control: checkbox, enabled: checked, kind: 'checkbox' };
  }
  return null;
}

async function expectToggleState(
  page: Page,
  moduleName: string,
  enabled: boolean
): Promise<ToggleControl> {
  // Re-resolve after every action: a server-rendered toggle reloads the page.
  await expect
    .poll(async () => (await resolveToggle(moduleRow(page, moduleName)))?.enabled, {
      message: `expected '${moduleName}' to be ${enabled ? 'enabled' : 'disabled'}`,
    })
    .toBe(enabled);
  const toggle = await resolveToggle(moduleRow(page, moduleName));
  if (!toggle) throw new Error(`toggle control for '${moduleName}' disappeared`);
  return toggle;
}

// A uniquely-named module so the row filter (substring match) is unambiguous.
const TOGGLE_MODULE = 'Custom Commands';

test.describe('modules administration', () => {
  test('lists the built-in modules with their state', async ({ page }) => {
    await gotoOk(page, '/modules');
    await expect(page.getByText('Audio Player').first()).toBeVisible();
    await expect(page.getByText('Announcements').first()).toBeVisible();
    await expect(page.getByText(TOGGLE_MODULE).first()).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/enabled|disabled|\bon\b|\boff\b/i);
  });

  test(`toggles ${TOGGLE_MODULE} and restores it, writing audit entries`, async ({ page }) => {
    await gotoOk(page, '/modules');

    const initial = await resolveToggle(moduleRow(page, TOGGLE_MODULE));
    if (!initial) throw new Error(`no enable/disable control found for ${TOGGLE_MODULE}`);

    await initial.control.click();
    const flipped = await expectToggleState(page, TOGGLE_MODULE, !initial.enabled);

    // Restore the original state so the suite stays idempotent.
    await flipped.control.click();
    await expectToggleState(page, TOGGLE_MODULE, initial.enabled);

    await gotoOk(page, '/audit-logs');
    await expect(page.getByText(/module\.[\w.-]+/i).first()).toBeVisible();
  });
});
