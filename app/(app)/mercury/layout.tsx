import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MercurySidebar from "@/components/mercury/MercurySidebar";
import { RoleProvider } from "@/lib/mercury/RoleContext";
import type { UserProfile } from "@/types/database";

/**
 * Mercury (ported Flo Portal) admin-only section.
 *
 * Defense-in-depth route guard: the "Mercury" nav entry is already only
 * ever rendered for ADMIN in components/Sidebar.tsx, but that alone only
 * hides the link -- it does nothing to stop someone who already knows (or
 * guesses/bookmarks) a /mercury/* URL. This layout re-checks the signed-in
 * user's role server-side, straight from Mondial's own user_profiles table
 * (the only auth/user store the merged app uses), on every request under
 * /mercury, and bounces non-admins back to the dashboard before any page
 * content or data fetch under this section ever runs.
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

  if (!profile || profile.role !== "ADMIN") {
    redirect("/");
  }

  return (
    // Mercury's ported pages (originally written against Flo Portal's own
    // role system) call useRole() in a few places (e.g. MercuryCrudTable's
    // readOnly gating). Everyone who reaches this layout is already a
    // Mondial ADMIN, so "admin" is the only role Mercury ever needs to
    // provide here.
    <RoleProvider role="admin">
      <div className="flex w-full items-start gap-6">
        <MercurySidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </RoleProvider>
  );
}
