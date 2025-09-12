import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { nextCookies } from "better-auth/next-js";

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

// Initialize Better Auth. You can extend this later with providers (e.g., Google).
export const auth = betterAuth({
  // Database is required at runtime; ensure BETTER_AUTH_DATABASE_URL or DATABASE_URL is set.
  database: pool,
  // Ensure cookies set by Better Auth propagate correctly in Next.js route handlers.
  plugins: [nextCookies()],
});
