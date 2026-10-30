import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoleProvider } from "@/lib/mercury/RoleContext";
import type { UserProfile } from "@/types/database";

/**
 * Booklet Summary is part of Mercury's Billing section, excluded entirely for
 * FLO_ASSOCIATE and MERCURY_ASSOCIATE (view-only everywhere else in Mercury).
 * See app/(app)/mercury/billing/layout.tsx for the full rationale -- same
 * guard, different route, because booklet-summary/page.tsx is also a
 * "use client" page with no server-side role check of its own.
 *
 * MERCURY_MERCHANDISER stays visible here too, view-only -- same nested
 * RoleProvider trick as the Billing layout, which booklet-summary/page.tsx's
 * own `readOnly = role === "general_manager"` check (added alongside this)
 * uses to hide the "Mark as Cancelled/Blank" control.
 *
 * ADMIN and LOGISTICS_OFFICER pass through unchanged.
 */
export default async function MercuryBookletSummaryLayout({ children }: { children: React.ReactNode }) {
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
