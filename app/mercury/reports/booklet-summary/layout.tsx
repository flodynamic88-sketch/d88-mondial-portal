import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/database";

/**
 * Booklet Summary print is part of Mercury's Billing section, excluded for
 * FLO_ASSOCIATE -- same guard as app/mercury/billing/layout.tsx and
 * app/(app)/mercury/booklet-summary/layout.tsx. ADMIN and
 * LOGISTICS_OFFICER pass through unchanged.
 */
export default async function MercuryPrintBookletSummaryLayout({
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
