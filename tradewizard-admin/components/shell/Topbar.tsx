"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ADMIN_NAV, activeNavHref } from "@/constants/routes";
import { ROLE_LABEL, type AdminIdentity } from "@/constants/roles";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { LogoMark } from "@/components/shell/Sidebar";

/**
 * The portal is small, so environment identity has to be explicit: `dev` and
 * `prod` look identical otherwise, and acting on the wrong one is expensive.
 */
function environment(): string | null {
  const base = process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL;
  if (!base) return null;

  try {
    const stage = new URL(base).pathname.replace(/\//g, "");
    if (!stage) return null;
    return stage === "v1" || stage === "prod" ? "prod" : stage;
  } catch {
    return null;
  }
}

const clock = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function Topbar({ identity }: { identity?: AdminIdentity }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAdminAuth();

  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(clock.format(new Date()).replace(",", ""));
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeHref = activeNavHref(pathname);
  const section = ADMIN_NAV.find((item) => item.href === activeHref);
  const env = environment();

  return (
    <header className="sticky top-0 z-30 flex min-h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-rail/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-sm md:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link className="lg:hidden" href="/overview" aria-label="TradeWizard overview">
          <LogoMark size={20} />
        </Link>

        {section ? (
          <nav aria-label="Current section" className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
            <span className="hidden text-faint sm:inline">Portal</span>
            <span aria-hidden className="hidden text-border-strong sm:inline">
              /
            </span>
            <span className="truncate text-fg">{section.label}</span>
            {section.hint && (
              <>
                <span aria-hidden className="hidden text-border-strong sm:inline">
                  ·
                </span>
                <span className="hidden truncate text-faint sm:inline">{section.hint}</span>
              </>
            )}
          </nav>
        ) : (
          <span className="truncate text-[11.5px] text-faint">TradeWizard operations</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <span className="mono hidden text-[10.5px] text-faint md:inline">
          {now ?? "—"}
        </span>

        {env && (
          <Badge tone={env === "prod" ? "accent" : "neutral"} dot>
            {env}
          </Badge>
        )}

        <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />

        {identity ? (
          <>
            <span className="hidden max-w-[220px] truncate text-[11.5px] text-muted sm:inline">
              {identity.email}
            </span>

            <Badge tone="neutral">{ROLE_LABEL[identity.role]}</Badge>

            <Badge tone={identity.mfa ? "yes" : "warning"} dot>
              <span className="hidden items-center gap-1 sm:inline-flex">
                <ShieldCheck size={10} aria-hidden />
              </span>
              {identity.mfa ? "MFA" : "no MFA"}
            </Badge>
          </>
        ) : (
          <span className="text-[11px] text-faint">checking session…</span>
        )}

        <button
          type="button"
          onClick={() => {
            signOut();
            router.replace("/login");
          }}
          className="ml-0.5 inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[11.5px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <LogOut size={13} aria-hidden />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
