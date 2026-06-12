import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    // Provided by the environment (Docker Compose injects it).
    url: process.env.DATABASE_URL ?? 'postgres://botplatform:botplatform@localhost:5432/botplatform',
  },
});
