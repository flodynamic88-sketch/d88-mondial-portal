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
  icon: (props: { className?: string }) => JSX.Element;
}

function IconDashboard({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconEncode({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M9 12h6M9 16h6M9 8h2M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconRoute({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6 8.5V13a4 4 0 0 0 4 4h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTruck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="18" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="18" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconBilling({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 9.5h18" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m8.5 12.5 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconFinal({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M7 3h10a1 1 0 0 1 1 1v16l-6-3-6 3V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 8.5a2.75 2.75 0 1 1 0 5.5M17.5 13.7c2 .3 3.5 1.7 4 3.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: IconDashboard },
  {
    href: "/encode",
    label: "Encode Invoices",
    roles: ["ADMIN", "JMD_PLANNER"],
    icon: IconEncode,
  },
  {
    href: "/route-plan",
    label: "Route Plan",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "JMD_PLANNER", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER"],
    icon: IconRoute,
  },
  {
    href: "/deliveries",
    label: "Deliveries Fulfillment",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "JMD_PLANNER", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER"],
    icon: IconTruck,
  },
  {
    href: "/billing",
    label: "Billing",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "GENERAL_MANAGER"],
    icon: IconBilling,
  },
  {
    href: "/mondial-confirmation",
    label: "Mondial Confirmation",
    roles: ["ADMIN", "MONDIAL_TEAM"],
    icon: IconCheck,
  },
  {
    href: "/final-billing",
    label: "Final Billing",
    roles: ["ADMIN", "LOGISTICS_OFFICER", "GENERAL_MANAGER"],
    icon: IconFinal,
  },
  { href: "/admin/users", label: "User Management", roles: ["ADMIN"], icon: IconUsers },
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
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm">
            M
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-gray-900">Mondial Portal</p>
            <p className="truncate text-xs text-gray-400">Dynamic88 Solutions</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {isActive && (
                <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-600" />
              )}
              <Icon
                className={`h-4.5 w-4.5 flex-shrink-0 ${
                  isActive ? "text-brand-600" : "text-gray-400 group-hover:text-gray-500"
                }`}
              />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-100 px-5 py-4">
        {profile && (
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-800">{profile.username}</p>
              <p className="truncate text-xs text-gray-400">{ROLE_LABELS[profile.role]}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
        >
          Sign Out
        </button>
        <p className="mt-3 text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Dynamic88 Solutions
        </p>
      </div>
    </aside>
  );
}
