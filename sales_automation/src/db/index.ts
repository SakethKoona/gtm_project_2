import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Reuse a single postgres client across hot reloads in dev.
const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>;
};

// Local Postgres vs. a hosted provider (Supabase, Neon, …):
//  - Hosted requires TLS. postgres.js "require" encrypts without CA verification,
//    which is what Supabase's connection strings use (sslmode=require).
//  - A transaction-mode pooler (pgBouncer — e.g. Supabase's :6543 pooler) does NOT
//    support prepared statements, so disable them there. Detected by the :6543
//    port or DATABASE_POOLED=true. Use the direct/session connection (5432) for
//    running migrations (DDL); the pooler is for the running app at scale.
const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString);
const isPooled =
  process.env.DATABASE_POOLED === "true" || connectionString.includes(":6543");

const client =
  globalForDb.__pgClient ??
  postgres(connectionString, {
    max: isPooled ? 1 : 10,
    ssl: isLocal ? false : "require",
    prepare: isPooled ? false : undefined,
  });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__pgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
