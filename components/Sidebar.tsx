"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { ROLE_LABELS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import { getAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import type { UserRole } from "@/types/database";

interface NavItem {
  href: string;
  label: string;
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    roles: [
      "ADMIN",
      "LOGISTICS_OFFICER",
      "MONDIAL_TEAM",
      "LOGISTICS_ASSOCIATE",
      "GENERAL_MANAGER",
    ],
  },
  {
    href: "/encode",
    label: "Encode Invoices",
    // JMD_ADMIN gets the same view-only access as JMD_PLANNER here -- the
    // page's canEdit check (ADMIN/LOGISTICS_OFFICER only) already hides the
    // add/edit UI for both, so this only grants read access to the list.
    roles: ["ADMIN", "LOGISTICS_OFFICER", "JMD_PLANNER", "JMD_ADMIN"],
  },
  {
    href: "/route-plan",
    label: "Route Plan",
    roles: [
      "ADMIN",
      "LOGISTICS_OFFICER",
      "JMD_PLANNER",
      "LOGISTICS_ASSOCIATE",
      "GENERAL_MANAGER",
      "JMD_ADMIN",
    ],
  },
  {
    href: "/deliveries",
    label: "Deliveries Fulfillment",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER"],
  },
  {
    href: "/billing",
    label: "Billing",
    roles: ["ADMIN", "GENERAL_MANAGER"],
  },
  {
    href: "/mondial-confirmation",
    label: "Mondial Confirmation",
    roles: ["ADMIN", "MONDIAL_TEAM", "INVOICING_TEAM"],
  },
  {
    href: "/delivery-variance",
    label: "Delivery Variance Log",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER"],
  },
  {
    href: "/transmittals",
    label: "Transmittals",
    roles: ["ADMIN", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER", "INVOICING_TEAM"],
  },
  {
    href: "/trucking-billing",
    label: "Trucking Billing",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "GENERAL_MANAGER"],
  },
  {
    href: "/final-billing",
    label: "Final Billing",
    roles: ["ADMIN", "GENERAL_MANAGER"],
  },
  { href: "/admin/users", label: "User Management", roles: ["ADMIN"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useAuth();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    getAppSetting(LOGO_SETTING_KEY).then(setLogoUrl);
  }, []);

  // "Mercury" (the ported Flo Portal admin section) is appended here --
  // never injected as a static NAV_ITEMS entry -- so it is completely
  // absent from the DOM for every role except ADMIN, not merely hidden.
  // Direct-URL access is separately blocked server-side by
  // app/(app)/mercury/layout.tsx.
  const items: NavItem[] =
    profile?.role === "ADMIN"
      ? [...NAV_ITEMS, { href: "/mercury", label: "Mercury", roles: ["ADMIN"] }]
      : NAV_ITEMS;

  const visibleItems = items.filter((item) => !item.roles || (profile && item.roles.includes(profile.role)));

  const initials = profile?.username
    ? profile.username.slice(0, 2).toUpperCase()
    : "?";

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="no-print flex h-14 w-full flex-shrink-0 items-center gap-4 border-b border-gray-800 bg-black px-4 sm:px-6">
      <Link href="/" className="flex flex-shrink-0 items-center gap-2.5">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Dynamic88 logo"
            className="h-8 w-8 flex-shrink-0 rounded-lg bg-white object-contain p-1"
          />
        ) : (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm">
            M
          </div>
        )}
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-bold leading-tight text-white">Mondial Portal</p>
        </div>
      </Link>

      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-2">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-shrink-0 items-center gap-3">
        {profile && (
          <div className="hidden items-center gap-2 md:flex">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt=""
                className="h-7 w-7 flex-shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                {initials}
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium text-white">{profile.username}</p>
              <p className="truncate text-[11px] text-gray-400">{ROLE_LABELS[profile.role]}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="flex-shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-white"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
