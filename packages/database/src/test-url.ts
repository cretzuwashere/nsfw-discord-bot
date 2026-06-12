/**
 * Resolve the connection URL for the integration-test database.
 *
 * Precedence: explicit TEST_DATABASE_URL wins; otherwise DATABASE_URL is
 * rewritten to point at "<database>_test" on the same server so integration
 * tests can never touch the real database.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;

  const baseUrl = env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      'Cannot resolve the test database URL: set TEST_DATABASE_URL, or set DATABASE_URL ' +
        '(its database name will be suffixed with "_test").'
    );
  }

  const url = new URL(baseUrl);
  const databaseName = url.pathname.replace(/^\//, '');
  if (!databaseName) {
    throw new Error(
      'DATABASE_URL has no database name in its path; cannot derive the "_test" database name.'
    );
  }
  url.pathname = `/${databaseName}_test`;
  return url.toString();
}
