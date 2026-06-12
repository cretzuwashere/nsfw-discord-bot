import { expect, test } from '@playwright/test';
import {
  E2E_ADMIN_EMAIL,
  emailField,
  expectNoStackTrace,
  login,
  passwordField,
} from './helpers.js';

// Auth flows must start unauthenticated — do not reuse the saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('authentication', () => {
  test('login page loads with email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading').or(page.locator('form')).first()).toBeVisible();
    await expect(emailField(page)).toBeVisible();
    await expect(passwordField(page)).toBeVisible();
  });

  test('invalid login stays on /login with a safe, non-revealing error', async ({ page }) => {
    await login(page, E2E_ADMIN_EMAIL, 'definitely-the-wrong-password');
    await page.waitForLoadState();

    await expect(page).toHaveURL(/\/login/);

    // A friendly error is shown...
    await expect(
      page.getByText(/invalid|incorrect|failed|unable|try again|denied/i).first()
    ).toBeVisible();

    // ...but never a raw error / stack trace...
    await expectNoStackTrace(page);

    // ...and never a hint about WHICH field was wrong.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(
      /wrong password|incorrect password|password (?:is )?(?:wrong|incorrect)|unknown (?:user|email)|email not (?:found|registered)|user (?:not found|does not exist)|no (?:account|user) (?:found|exists)/i
    );
  });

  test('valid login lands on the dashboard', async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/dashboard/);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('logout returns to login and protects the dashboard again', async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/dashboard/);

    const logoutControl = page
      .getByRole('button', { name: /log ?out|sign ?out/i })
      .or(page.getByRole('link', { name: /log ?out|sign ?out/i }))
      .first();
    await expect(logoutControl).toBeVisible();
    await logoutControl.click();
    await page.waitForURL(/\/login/);

    // The session is gone: protected pages bounce back to the login form.
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/);
  });
});
