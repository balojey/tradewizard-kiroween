"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { ADMIN_NAV, activeNavHref } from "@/constants/routes";
import { hasRole, type AdminIdentity } from "@/constants/roles";

function MobileNav({ identity }: { identity?: AdminIdentity }) {
  const pathname = usePathname();
  const active = activeNavHref(pathname);
  const role = identity?.role;

  return (
    <nav
      aria-label="Sections"
      className="flex gap-1 overflow-x-auto border-b border-border bg-rail px-3 py-2 lg:hidden"
    >
      {ADMIN_NAV.filter((item) => item.ready && (!role || hasRole(role, item.requires))).map(
        (item) => {
          const isActive = active === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={[
                "whitespace-nowrap rounded-[6px] px-2.5 py-1 text-[11.5px] transition-colors",
                isActive
                  ? "bg-surface-2 font-medium text-fg"
                  : "text-muted hover:bg-hover hover:text-fg",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        }
      )}
    </nav>
  );
}

export function AdminShell({
  identity,
  children,
}: {
  identity?: AdminIdentity;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[6px] focus:border focus:border-accent focus:bg-surface focus:px-3 focus:py-1.5 focus:text-[12px] focus:text-fg"
      >
        Skip to content
      </a>

      <Sidebar identity={identity} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar identity={identity} />
        <MobileNav identity={identity} />

        <main
          id="main"
          className="min-w-0 flex-1 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 md:px-6 md:pt-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
