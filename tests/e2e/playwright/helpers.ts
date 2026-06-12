import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Matches the seeded E2E user (see .env.example / packages/database seed). */
export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.com';
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e_test_password_123';

/**
 * Selectors are intentionally generous: the admin templates are written in
 * parallel and we do not control their markup. Inputs are matched by
 * name/type, buttons by accessible name.
 */
export function emailField(page: Page): Locator {
  return page.locator('input[name="email"], input[type="email"], #email').first();
}

export function passwordField(page: Page): Locator {
  return page.locator('input[name="password"], input[type="password"], #password').first();
}

export function loginSubmitButton(page: Page): Locator {
  return page
    .getByRole('button', { name: /log ?in|sign ?in|submit/i })
    .or(page.locator('form button[type="submit"], form input[type="submit"]'))
    .first();
}

/** Fill the login form and submit. Does not assert the outcome. */
export async function login(
  page: Page,
  email: string = E2E_ADMIN_EMAIL,
  password: string = E2E_ADMIN_PASSWORD
): Promise<void> {
  await page.goto('/login');
  await emailField(page).fill(email);
  await passwordField(page).fill(password);
  await loginSubmitButton(page).click();
}

/** Navigate and assert the server did not answer with an error status. */
export async function gotoOk(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response, `expected a response from ${path}`).not.toBeNull();
  expect(response?.status(), `expected a non-5xx, non-4xx response from ${path}`).toBeLessThan(400);
}

/** Raw error output (stack frames, error class names) must never be rendered. */
export async function expectNoStackTrace(page: Page): Promise<void> {
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/\bat .+\.(?:ts|js):\d+/);
  expect(bodyText).not.toMatch(/\b(?:Type|Reference|Syntax|Range)Error:/);
  expect(bodyText).not.toMatch(/\b(?:PlatformError|UserFacingError|FastifyError)\b/);
}

const SECRET_ENV_KEYS = [
  'SESSION_SECRET',
  'INTERNAL_API_TOKEN',
  'ADMIN_PASSWORD',
  'E2E_ADMIN_PASSWORD',
  'POSTGRES_PASSWORD',
] as const;

/**
 * Assert that no configured secret VALUE appears anywhere in the rendered
 * HTML. Unset (or implausibly short) values are skipped to avoid false
 * positives on incidental substrings.
 */
export async function expectNoSecretsRendered(page: Page): Promise<void> {
  const html = await page.content();
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (!value || value.length < 4) continue;
    expect(html.includes(value), `page must not render the value of ${key}`).toBe(false);
  }
}
