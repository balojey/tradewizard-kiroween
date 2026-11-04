import type { AdminRole } from "./roles";

export interface AdminNavItem {
  label: string;
  href: string;
  /** Minimum role required to see the link at all. */
  requires: AdminRole;
  /** Enabled once the route exists; the rest are placeholders for later slices. */
  ready: boolean;
  /** One line of context, shown in the mobile jump list. */
  hint?: string;
}

export interface AdminNavGroup {
  label: string;
  items: readonly AdminNavItem[];
}

/**
 * Navigation is grouped by the question the operator is answering, not by the
 * database table behind it: what is happening now, who is affected, what did
 * the system decide, where is money at risk, and what is on the record.
 */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: "Monitor",
    items: [
      { label: "Overview", href: "/overview", requires: "analyst", ready: true, hint: "Business metrics" },
      { label: "Ops", href: "/ops", requires: "analyst", ready: true, hint: "Queues, errors, alarms" },
    ],
  },
  {
    label: "Customers",
    items: [
      { label: "Users", href: "/users", requires: "analyst", ready: true, hint: "Accounts and credits" },
      { label: "Billing", href: "/billing", requires: "analyst", ready: true, hint: "Payments and renewals" },
      { label: "Support", href: "/support", requires: "support", ready: true, hint: "Customer requests" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Analyses", href: "/analyses", requires: "analyst", ready: true, hint: "Results and quality" },
      { label: "Markets", href: "/markets", requires: "analyst", ready: true, hint: "Schedule pool" },
      { label: "Agents", href: "/agents", requires: "analyst", ready: true, hint: "Calibration and cost" },
    ],
  },
  {
    label: "Trading",
    items: [
      { label: "Portfolio", href: "/portfolio", requires: "analyst", ready: true, hint: "Sessions and exposure" },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Audit", href: "/audit", requires: "analyst", ready: true, hint: "Every mutation" },
      { label: "Members", href: "/members", requires: "owner", ready: true, hint: "Portal access" },
      { label: "Settings", href: "/settings", requires: "owner", ready: true, hint: "Runtime configuration" },
    ],
  },
] as const;

/** Flat list, kept for the mobile nav and for lookups by href. */
export const ADMIN_NAV: readonly AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap((group) => group.items);

/** Longest-prefix match so detail pages keep their section highlighted. */
export function activeNavHref(pathname: string): string | null {
  const match = ADMIN_NAV.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  ).sort((a, b) => b.href.length - a.href.length)[0];

  return match?.href ?? null;
}

/** Breadcrumb trail for a pathname, e.g. /users/abc → [Users, abc]. */
export function navTrail(pathname: string): AdminNavItem[] {
  const href = activeNavHref(pathname);
  const section = href ? ADMIN_NAV.find((item) => item.href === href) : undefined;
  return section ? [section] : [];
}

export const PUBLIC_PATHS = ["/login"] as const;
