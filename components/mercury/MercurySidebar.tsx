"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Ported from Flo Portal's components/Sidebar.tsx NAV_SECTIONS, minus the
// "Administration" (Users) section -- Flo's own user management is
// obsolete now that only Mondial's auth/user_profiles/roles are used -- and
// minus the standalone Profile page, since Mondial already has its own.
const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/mercury", label: "Dashboard" }],
  },
  {
    title: "Deliveries",
    items: [
      { href: "/mercury/deliveries", label: "Deliveries" },
      { href: "/mercury/purchase-orders", label: "Purchase Orders" },
    ],
  },
  {
    title: "Warehouse",
    items: [
      { href: "/mercury/inventory", label: "Inventory" },
      { href: "/mercury/inventory/receiving", label: "Stock Receiving" },
      { href: "/mercury/stock-requests", label: "Stock Requests" },
      { href: "/mercury/dispatch", label: "For Dispatch" },
      { href: "/mercury/warehouse/stock-movement-history", label: "Stock Movement History" },
      { href: "/mercury/warehouse/bin-tag", label: "Bin Tag" },
      { href: "/mercury/bad-orders", label: "Bad Orders" },
    ],
  },
  {
    title: "Store Visits",
    items: [
      { href: "/mercury/store-visits", label: "Store Visits" },
      { href: "/mercury/store-visits/monitoring", label: "Stock Monitoring (Per Client)" },
      { href: "/mercury/store-visits/count-sheet", label: "Inventory Count Sheet (Print)" },
    ],
  },
  {
    title: "Reports",
    items: [
      { href: "/mercury/reports/monthly-sales", label: "Monthly Sales" },
      { href: "/mercury/reports/branch-sales", label: "Branch Sales" },
      { href: "/mercury/reports/branch-performance", label: "Branch Performance" },
      { href: "/mercury/reports/year-view", label: "Year View" },
      { href: "/mercury/reports/items-delivered-summary", label: "Items Delivered Summary" },
      { href: "/mercury/reports/sales-report", label: "Sales Report (Client)" },
      { href: "/mercury/reports/inventory-report", label: "Inventory Report (Client)" },
      { href: "/mercury/reports/bad-order-report", label: "Bad Order Report (Client)" },
    ],
  },
  {
    title: "Billing",
    items: [
      { href: "/mercury/billing", label: "Billing" },
      { href: "/mercury/booklet-summary", label: "Booklet Summary" },
    ],
  },
  {
    title: "Incident Reports",
    items: [{ href: "/mercury/incident-reports", label: "Incident Reports" }],
  },
  {
    title: "Master Data",
    items: [
      { href: "/mercury/clients", label: "Clients" },
      { href: "/mercury/branches", label: "Branches" },
      { href: "/mercury/items", label: "Items" },
      { href: "/mercury/client-branch-links", label: "Client-Branch Links" },
      { href: "/mercury/settings", label: "Settings" },
    ],
  },
];

interface MercurySidebarProps {
  // FLO_ASSOCIATE gets full coverage of Mercury except Billing -- hides the
  // "Billing" section (Billing, Booklet Summary) from the nav entirely, so
  // it's absent from the DOM rather than merely hidden. The matching
  // server-side guard lives in the billing/booklet-summary route layouts.
  hideBilling?: boolean;
}

export default function MercurySidebar({ hideBilling = false }: MercurySidebarProps) {
  const pathname = usePathname();
  const sections = hideBilling
    ? NAV_SECTIONS.filter((section) => section.title !== "Billing")
    : NAV_SECTIONS;

  return (
    <aside className="no-print sticky top-8 hidden w-56 flex-shrink-0 rounded-xl border border-gray-800 bg-black py-4 md:block">
      <div className="border-b border-gray-800 px-4 pb-3">
        <p className="text-sm font-bold leading-tight text-white">Mercury</p>
        <p className="mt-0.5 text-xs text-gray-400">Flo Portal (Mercury Drug)</p>
      </div>
      <nav className="mt-3 space-y-4 px-3">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {section.title}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-brand-600 text-white"
                        : "text-gray-300 hover:bg-gray-800 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
