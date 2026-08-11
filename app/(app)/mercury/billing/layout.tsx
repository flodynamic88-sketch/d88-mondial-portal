import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/database";

/**
 * Billing is the one part of Mercury FLO_ASSOCIATE does not get. The parent
 * app/(app)/mercury/layout.tsx already lets FLO_ASSOCIATE into /mercury/*
 * generally (and hides this nav section for it), so this route needs its
 * own guard -- otherwise a bookmarked/typed /mercury/billing URL would still
 * load for FLO_ASSOCIATE, since billing/page.tsx is a "use client" page with
 * no server-side role check of its own. ADMIN passes through unchanged.
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

  if (profile?.role === "FLO_ASSOCIATE") {
    redirect("/mercury");
  }

  return <>{children}</>;
}
