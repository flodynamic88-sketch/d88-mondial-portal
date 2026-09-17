import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/database";

/**
 * Standalone print-route layout for the Mercury (ported Flo Portal)
 * section.
 *
 * This intentionally lives OUTSIDE the `(app)` route group (and outside
 * `(app)/mercury`), even though every page nested under here resolves to
 * the same `/mercury/...` URLs that the regular Mercury pages link to
 * (e.g. "/mercury/deliveries/[id]/print"). That's deliberate: Next.js
 * route groups don't add URL segments, so a plain top-level `app/mercury`
 * folder can contribute leaf routes like `/mercury/deliveries/[id]/print`
 * without colliding with `app/(app)/mercury/deliveries/[id]/page.tsx`
 * (which owns "/mercury/deliveries/[id]" itself) -- as long as the exact
 * leaf paths don't overlap. This mirrors how the original Flo Portal kept
 * its print pages in a plain top-level `app/<section>/print` tree, separate
 * from the `app/(app)/<section>` tree used for normal pages, specifically
 * so print pages never inherit the app shell (Sidebar / MercurySidebar /
 * max-width content padding) that would otherwise break print layouts.
 *
 * Since this layout does NOT sit under `(app)/mercury/layout.tsx`, it does
 * its own defense-in-depth role check here (same roles as
 * `(app)/mercury/layout.tsx` -- ADMIN, FLO_ASSOCIATE, LOGISTICS_OFFICER --
 * straight from Mondial's user_profiles table) rather than inheriting one.
 *
 * This was left ADMIN-only when FLO_ASSOCIATE (migration 0052) and later
 * LOGISTICS_OFFICER (migration 0085) were opened up to the rest of Mercury,
 * which silently redirected both of them to "/" on every print/export
 * action (Billing Statement, SOA, Booklet Summary, all Reports prints,
 * Delivery/Dispatch/Incident/Stock Request/Count Sheet/Bin Tag prints) even
 * though the on-screen pages themselves loaded fine. Fixed here; the two
 * FLO_ASSOCIATE-excluded routes (Billing prints, Booklet Summary print)
 * re-guard themselves in their own nested layout.tsx, same pattern as
 * app/(app)/mercury/billing/layout.tsx and
 * app/(app)/mercury/booklet-summary/layout.tsx.
 */
export default async function MercuryPrintLayout({ children }: { children: React.ReactNode }) {
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

  if (
    !profile ||
    (profile.role !== "ADMIN" &&
      profile.role !== "FLO_ASSOCIATE" &&
      profile.role !== "LOGISTICS_OFFICER")
  ) {
    redirect("/");
  }

  return <>{children}</>;
}
