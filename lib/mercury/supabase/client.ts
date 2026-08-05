"use client";

import { createBrowserClient } from "@supabase/ssr";

// Mercury (ported Flo Portal) browser Supabase client.
//
// Deliberately untyped (no `Database` generic) unlike Mondial's own
// lib/supabase/client.ts -- Mercury's data lives in the separate `flo`
// Postgres schema (not `public`), which Mondial's typed `Database`
// interface does not describe. Every query from Mercury pages must target
// that schema explicitly via `.schema("flo").from("table_name")`.
//
// Auth/session/cookies are still Mondial's -- this is the same Supabase
// project, same `@supabase/ssr` cookie-based session, just a client that
// isn't pinned to the `public`-only generic type so `.schema("flo")` type
// checks.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

  return createBrowserClient(url, anonKey);
}
