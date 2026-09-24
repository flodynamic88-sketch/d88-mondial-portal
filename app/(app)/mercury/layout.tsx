import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MercurySidebar from "@/components/mercury/MercurySidebar";
import { RoleProvider } from "@/lib/mercury/RoleContext";
import type { UserProfile } from "@/types/database";

/**
 * Mercury (ported Flo Portal) section -- ADMIN, FLO_ASSOCIATE,
 * LOGISTICS_OFFICER, and MERCURY_ASSOCIATE only.
 *
 * Defense-in-depth route guard: the "Mercury" nav entry is already only
 * ever rendered for ADMIN/FLO_ASSOCIATE/LOGISTICS_OFFICER/MERCURY_ASSOCIATE
 * in components/Sidebar.tsx, but that alone only hides the link -- it does
 * nothing to stop someone who already knows (or guesses/bookmarks) a
 * /mercury/* URL. This layout re-checks the signed-in user's role
 * server-side, straight from Mondial's own user_profiles table (the only
 * auth/user store the merged app uses), on every request under /mercury,
 * and bounces anyone else back to the dashboard before any page content or
 * data fetch under this section ever runs.
 *
 * FLO_ASSOCIATE gets full coverage of Mercury except Billing: that
 * exclusion is enforced here (hideBilling passed to MercurySidebar so the
 * nav section doesn't render) and again, per-route, in
 * app/(app)/mercury/billing/layout.tsx and
 * app/(app)/mercury/booklet-summary/layout.tsx (so a bookmarked/typed URL
 * still bounces even though this layout lets FLO_ASSOCIATE into /mercury/*
 * generally). At the database layer, migration 0052 mirrors this: every
 * flo-schema table FLO_ASSOCIATE needs is opened up to it, except
 * booklet_invoice_status, which stays ADMIN-only.
 *
 * LOGISTICS_OFFICER was granted full Mercury access (including Billing and
 * Booklet Summary, per explicit request with no carve-out) -- it passes
 * this guard and both per-route Billing/Booklet-Summary guards unaffected
 * (those two only redirect FLO_ASSOCIATE), and migration 0085 opens the
 * flo-schema RLS -- including booklet_invoice_status -- to it as well.
 *
 * MERCURY_ASSOCIATE is VIEW-ONLY across all of Mercury, and (like
 * FLO_ASSOCIATE) has no access at all to Billing/Booklet Summary -- both
 * hidden here via hideBilling and blocked again at the route layouts. The
 * RoleProvider below maps it to Mercury's own legacy "general_manager"
 * role, which is the one role value the ported Mercury pages already treat
 * as read-only everywhere (MercuryCrudTable and every add/edit entry point
 * check `role === "general_manager"`) -- search/filtering is untouched by
 * this, since none of those checks gate search. Migration 0086 backs this
 * with SELECT-only RLS on the flo schema (no insert/update/delete grants).
 */
export default async function MercuryLayout({ children }: { children: React.ReactNode }) {
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
      profile.role !== "LOGISTICS_OFFICER" &&
      profile.role !== "MERCURY_ASSOCIATE")
  ) {
    redirect("/");
  }

  const isFloAssociate = profile.role === "FLO_ASSOCIATE";
  const isMercuryAssociate = profile.role === "MERCURY_ASSOCIATE";

  return (
    // Mercury's ported pages (originally written against Flo Portal's own
    // role system) call useRole() in a few places (e.g. MercuryCrudTable's
    // readOnly gating). ADMIN/FLO_ASSOCIATE/LOGISTICS_OFFICER get full
    // (non-readOnly) Mercury coverage via "admin"; MERCURY_ASSOCIATE gets
    // "general_manager", the pre-existing read-only role value.
    <RoleProvider role={isMercuryAssociate ? "general_manager" : "admin"}>
      {/* Break out of the parent (app) layout's max-w-6xl container so
          Mercury's wide tables/reports get the full viewport width instead
          of being squeezed into Mondial's narrower default content column. */}
      <div className="mx-[calc(50%-50vw)] w-screen px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1800px] items-start gap-6">
          <MercurySidebar hideBilling={isFloAssociate || isMercuryAssociate} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </RoleProvider>
  );
}
