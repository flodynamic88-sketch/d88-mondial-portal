"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/encode", label: "Encode Invoices" },
  { href: "/route-plan", label: "Route Plan" },
  { href: "/deliveries", label: "Deliveries Fulfillment" },
  { href: "/billing", label: "Billing" },
  { href: "/mondial-confirmation", label: "Mondial Confirmation" },
  { href: "/final-billing", label: "Final Billing" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-5">
        <p className="text-lg font-bold text-brand-700">Mondial Portal</p>
        <p className="text-xs text-gray-500">Dynamic88 Solutions</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-200 px-5 py-4 text-xs text-gray-400">
        &copy; {new Date().getFullYear()} Dynamic88 Solutions
      </div>
    </aside>
  );
}
