import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoleProvider } from "@/lib/mercury/RoleContext";
import type { UserProfile } from "@/types/database";

/**
 * Billing is the one part of Mercury FLO_ASSOCIATE does not get, and
 * MERCURY_ASSOCIATE (view-only everywhere else in Mercury) doesn't get it
 * either -- both are redirected away entirely. The parent
 * app/(app)/mercury/layout.tsx already lets both roles into /mercury/*
 * generally (and hides this nav section for them), so this route needs its
 * own guard -- otherwise a bookmarked/typed /mercury/billing URL would still
 * load, since billing/page.tsx is a "use client" page with no server-side
 * role check of its own.
 *
 * MERCURY_MERCHANDISER is different: Billing stays visible for it, just
 * view-only (per explicit user decision), so instead of redirecting it we
 * nest a RoleProvider forcing "general_manager" -- the same read-only role
 * value billing/page.tsx already checks for (`readOnly = role ===
 * "general_manager"`), which hides the status checkboxes, bulk-action bar,
 * and the "Generate SOA" button, while the page itself still renders and the
 * underlying data (filtered by RLS, see migration 0090) is still visible.
 *
 * ADMIN and LOGISTICS_OFFICER pass through unchanged.
 */
export default async function MercuryBillingLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<UserProfile>();

  if (profile?.role === "FLO_ASSOCIATE" || profile?.role === "MERCURY_ASSOCIATE") {
    redirect("/mercury");
  }

  if (profile?.role === "MERCURY_MERCHANDISER") {
    return <RoleProvider role="general_manager">{children}</RoleProvider>;
  }

  return <>{children}</>;
}
