import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { nextCookies } from "better-auth/next-js";
import { customSession } from "better-auth/plugins";
import { getMigrations } from "better-auth/db";
import { Polar } from "@polar-sh/sdk";
import { checkout, polar, portal, usage } from "@polar-sh/better-auth";
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

const polarPlugins = [];
const polarAccessToken =
  process.env.POLAR_ACCESS_TOKEN ||
  process.env.POLAR_OAT ||
  process.env.POLAR_ORGANIZATION_ACCESS_TOKEN ||
  "";

if (polarAccessToken) {
  const rawApiBase = (process.env.POLAR_API_BASE || "https://api.polar.sh/v1").trim();
  const envServer = (process.env.POLAR_SERVER || process.env.POLAR_ENV || "").trim().toLowerCase();
  let server;
  let serverUrl;

  if (envServer === "sandbox" || envServer === "production") {
    server = envServer;
  } else if (rawApiBase) {
    const normalized = rawApiBase.replace(/\/+$/, "");
    const root = normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
    if (root === "https://sandbox-api.polar.sh") {
      server = "sandbox";
    } else if (root === "https://api.polar.sh") {
      server = "production";
    } else if (root) {
      serverUrl = root;
    }
  }

  const polarClientConfig = {
    accessToken: polarAccessToken,
  };
  if (server) {
    polarClientConfig.server = server;
  } else if (serverUrl) {
    polarClientConfig.serverUrl = serverUrl;
  }

  const polarClient = new Polar(polarClientConfig);

  polarPlugins.push(
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          authenticatedUsersOnly: true,
          successUrl: "/billing/success?checkout_id={CHECKOUT_ID}",
        }),
        portal(),
        usage(),
      ],
    })
  );
}

const authOptions = {
  database: pool,
  plugins: [
    nextCookies(),
    customSession(async ({ user, session }) => {
      const isAdmin = isAdminEmail(user?.email);
      return { user: { ...user, isAdmin }, session };
    }),
    ...polarPlugins,
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
