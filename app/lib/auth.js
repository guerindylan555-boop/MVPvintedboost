import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { nextCookies } from "better-auth/next-js";
import { customSession } from "better-auth/plugins";
import { getMigrations } from "better-auth/db";
import { isAdminEmail } from "@/app/lib/admin";

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
          // Map Google profile to enrich the user if needed
          mapProfileToUser: (profile) => {
            const firstName = profile?.given_name;
            const lastName = profile?.family_name;
            return {
              name: profile?.name || [firstName, lastName].filter(Boolean).join(" "),
              image: profile?.picture,
            };
          },
        },
      }
    : undefined;

const authOptions = {
  database: pool,
  plugins: [
    nextCookies(),
    customSession(async ({ user, session }) => {
      const isAdmin = isAdminEmail(user?.email);
      return { user: { ...user, isAdmin }, session };
    }),
  ],
  // Optional, recommended in production
  secret: process.env.BETTER_AUTH_SECRET,
  // Ensure Better Auth builds absolute URLs correctly (falls back to headers if missing)
  baseURL: process.env.BETTER_AUTH_URL,
  // Respect base URL via env (BETTER_AUTH_URL)
  ...(socialProviders
    ? {
        socialProviders: {
          ...socialProviders,
          // Allow all users to sign up and sign in via Google
        },
      }
    : {}),
};

// Initialize Better Auth instance
export const auth = betterAuth(authOptions);

// Lazy migration runner to avoid doing network work on non-auth pages
let didMigrate = false;
export async function migrateIfNeeded() {
  if (didMigrate || !pool) return;
  try {
    const { runMigrations } = await getMigrations(authOptions);
    await runMigrations();
    didMigrate = true;
  } catch (err) {
    console.error("Better Auth migrations failed (will continue):", err);
  }
}
