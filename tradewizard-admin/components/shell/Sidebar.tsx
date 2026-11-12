"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  CreditCard,
  Gauge,
  LineChart,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { ADMIN_NAV_GROUPS, activeNavHref } from "@/constants/routes";
import { hasRole, type AdminIdentity } from "@/constants/roles";

const ICONS: Record<string, LucideIcon> = {
  "/overview": Gauge,
  "/ops": Activity,
  "/users": Users,
  "/billing": CreditCard,
  "/analyses": ScanSearch,
  "/markets": CalendarClock,
  "/agents": Bot,
  "/portfolio": LineChart,
  "/audit": ScrollText,
  "/members": ShieldCheck,
  "/settings": SlidersHorizontal,
};

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className="shrink-0"
      fill="none"
    >
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="5" stroke="var(--border-strong)" />
      <rect x="5.6" y="6.4" width="12.8" height="2.6" rx="1.3" fill="var(--accent)" />
      <rect x="5.6" y="10.9" width="12.8" height="2.6" rx="1.3" fill="var(--border-strong)" />
      <rect x="5.6" y="15.4" width="8.2" height="2.6" rx="1.3" fill="var(--border-strong)" />
    </svg>
  );
}

export function Sidebar({ identity }: { identity?: AdminIdentity }) {
  const pathname = usePathname();
  const active = activeNavHref(pathname);
  const role = identity?.role;

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-rail lg:sticky lg:top-0 lg:flex lg:h-screen">
      <Link
        href="/overview"
        className="flex items-center gap-2.5 border-b border-border-soft px-4 py-3.5 transition-colors hover:bg-hover"
      >
        <LogoMark />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium leading-tight text-fg">TradeWizard Warden</div>
          <div className="truncate text-[10.5px] leading-tight text-faint">Operations control plane</div>
        </div>
      </Link>

      <nav aria-label="Sections" className="flex-1 overflow-y-auto px-2 py-3">
        {ADMIN_NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !role || hasRole(role, item.requires));
          if (items.length === 0) return null;

          return (
            <div key={group.label} className="mb-3 last:mb-0">
              <div className="micro px-2.5 pb-1">{group.label}</div>

              <ul>
                {items.map((item) => {
                  const Icon = ICONS[item.href] ?? Gauge;
                  const isActive = active === item.href;

                  if (!item.ready) {
                    return (
                      <li key={item.href}>
                        <div className="flex items-center justify-between rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-faint/60">
                          <span className="flex items-center gap-2">
                            <Icon size={14} aria-hidden />
                            {item.label}
                          </span>
                          <span className="text-[9.5px] uppercase tracking-[0.08em]">soon</span>
                        </div>
                      </li>
                    );
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={[
                          "group relative flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[12.5px] transition-colors",
                          isActive
                            ? "bg-surface-2 font-medium text-fg"
                            : "text-muted hover:bg-hover hover:text-fg",
                        ].join(" ")}
                      >
                        {isActive && (
                          <span
                            aria-hidden
                            className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent"
                          />
                        )}
                        <Icon
                          size={14}
                          aria-hidden
                          className={isActive ? "text-accent" : "text-faint group-hover:text-muted"}
                        />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border-soft px-4 py-3">
        <div className="flex items-center justify-between text-[10.5px] text-faint">
          <span className="uppercase tracking-[0.09em]">Internal</span>
          <span className="mono">v0.1</span>
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
          Every action is written to the audit log.
        </p>
      </div>
    </aside>
  );
}
