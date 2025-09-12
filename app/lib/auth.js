import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { nextCookies } from "better-auth/next-js";
import { getMigrations } from "better-auth/db";

// Prefer a dedicated URL for Better Auth; fallback to DATABASE_URL.
// Accept Python-style Postgres URLs by normalizing the scheme for node-postgres.
const rawUrl = process.env.BETTER_AUTH_DATABASE_URL || process.env.DATABASE_URL;
let connectionString = rawUrl;
if (connectionString) {
  // Normalize common Python-style schemes to node-postgres compatible.
  connectionString = connectionString
    .replace(/^postgresql\+psycopg2:\/\//, "postgres://")
    .replace(/^postgresql:\/\//, "postgres://");
}

// Only create the pool if we have a connection string to avoid build-time failures.
const pool = connectionString ? new Pool({ connectionString }) : undefined;

// Build Better Auth options once so we can reuse for migrations.
const socialProviders =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          accessType: "offline",
          prompt: "select_account consent",
        },
      }
    : undefined;

const authOptions = {
  database: pool,
  plugins: [nextCookies()],
  // Optional, recommended in production
  secret: process.env.BETTER_AUTH_SECRET,
  // Respect base URL via env (BETTER_AUTH_URL); Better Auth will infer path.
  ...(socialProviders ? { socialProviders } : {}),
};

// Initialize Better Auth instance
export const auth = betterAuth(authOptions);

// Best-effort: run DB migrations automatically at startup if a DB is configured.
export const migrationsReady = (async () => {
  if (!pool) return;
  try {
    const { runMigrations } = await getMigrations(authOptions);
    await runMigrations();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Better Auth migrations failed (will continue):", err);
  }
})();

// Export the pg pool for diagnostics
export const dbPool = pool;
