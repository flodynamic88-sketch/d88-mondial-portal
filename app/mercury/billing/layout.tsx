import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/database";

/**
 * Billing prints (Billing Statement, SOA, SOA-Mondial) are the one part of
 * Mercury FLO_ASSOCIATE does not get. The parent app/mercury/layout.tsx
 * already lets FLO_ASSOCIATE into this standalone print-route tree
 * generally (ADMIN/FLO_ASSOCIATE/LOGISTICS_OFFICER), so this route needs
 * its own guard -- same pattern as app/(app)/mercury/billing/layout.tsx.
 * ADMIN and LOGISTICS_OFFICER pass through unchanged.
 */
export default async function MercuryPrintBillingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
