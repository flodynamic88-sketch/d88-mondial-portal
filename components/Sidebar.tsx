"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { ROLE_LABELS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";

interface NavItem {
  href: string;
  label: string;
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  {
    href: "/encode",
    label: "Encode Invoices",
    roles: ["ADMIN", "JMD_PLANNER"],
  },
  {
    href: "/route-plan",
    label: "Route Plan",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "JMD_PLANNER", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER"],
  },
  {
    href: "/deliveries",
    label: "Deliveries Fulfillment",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "JMD_PLANNER", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER"],
  },
  {
    href: "/billing",
    label: "Billing",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "GENERAL_MANAGER"],
  },
  {
    href: "/mondial-confirmation",
    label: "Mondial Confirmation",
    roles: ["ADMIN", "MONDIAL_TEAM"],
  },
  {
    href: "/delivery-variance",
    label: "Delivery Variance Log",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "JMD_PLANNER", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER"],
  },
  {
    href: "/final-billing",
    label: "Final Billing",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "GENERAL_MANAGER"],
  },
  { href: "/admin/users", label: "User Management", roles: ["ADMIN"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useAuth();

  const visibleItems = NAV_ITEMS.filter((item) => !item.roles || (profile && item.roles.includes(profile.role)));

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
    <aside className="no-print flex h-screen w-64 flex-shrink-0 flex-col border-r border-gray-800 bg-black">
      <div className="border-b border-gray-800 px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm">
            M
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-white">Mondial Portal</p>
            <p className="truncate text-xs text-gray-400">Dynamic88 Solutions</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
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
      <div className="border-t border-gray-800 px-5 py-4">
        {profile && (
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{profile.username}</p>
              <p className="truncate text-xs text-gray-400">{ROLE_LABELS[profile.role]}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="w-full rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-white"
        >
          Sign Out
        </button>
        <p className="mt-3 text-xs text-gray-500">
          &copy; {new Date().getFullYear()} Dynamic88 Solutions
        </p>
      </div>
    </aside>
  );
}
