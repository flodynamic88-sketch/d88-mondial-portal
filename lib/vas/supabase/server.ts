import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// VAS server Supabase client. See client.ts for why this is untyped and
// separate from Mondial's lib/supabase/server.ts -- VAS data lives in the
// `vas` schema, queried via `.schema("vas")`.
export function createClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Called from a Server Component where cookies can't be set.
          // Safe to ignore when middleware handles session refresh instead.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Same as above.
        }
      },
    },
  });
}
