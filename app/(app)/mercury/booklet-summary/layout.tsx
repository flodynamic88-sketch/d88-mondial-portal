import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/database";

/**
 * Booklet Summary is part of Mercury's Billing section, excluded for
 * FLO_ASSOCIATE. See app/(app)/mercury/billing/layout.tsx for the full
 * rationale -- same guard, different route, because
 * booklet-summary/page.tsx is also a "use client" page with no server-side
 * role check of its own. ADMIN passes through unchanged.
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

  if (profile?.role === "FLO_ASSOCIATE") {
    redirect("/mercury");
  }

  return <>{children}</>;
}
