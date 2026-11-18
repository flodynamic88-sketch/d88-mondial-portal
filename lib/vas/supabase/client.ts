"use client";

import { createBrowserClient } from "@supabase/ssr";

// VAS browser Supabase client.
//
// Deliberately untyped (no `Database` generic) unlike Mondial's own
// lib/supabase/client.ts -- VAS data lives in the separate `vas` Postgres
// schema (not `public`), which Mondial's typed `Database` interface does
// not describe. Every query from VAS pages must target that schema
// explicitly via `.schema("vas").from("table_name")`. Same pattern as
// lib/mercury/supabase/client.ts for the `flo` schema.
//
// Auth/session/cookies are still Mondial's -- this is the same Supabase
// project, same `@supabase/ssr` cookie-based session, just a client that
// isn't pinned to the `public`-only generic type so `.schema("vas")` type
// checks.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

  return createBrowserClient(url, anonKey);
}
