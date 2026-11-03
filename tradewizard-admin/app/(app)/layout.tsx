"use client";

import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/shell/Sidebar";
import { MfaSetup } from "@/components/auth/MfaSetup";
import { AdminShell } from "@/components/shell/AdminShell";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type { AdminApiError } from "@/lib/admin-api";

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-5 flex items-center gap-2.5">
          <LogoMark size={22} />
          <span className="text-[12.5px] font-medium text-fg">TradeWizard operations</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function AccessProblem({ error }: { error: AdminApiError }) {
  const { signOut, idToken } = useAdminAuth();
  const isAuth = error.status === 401;
  const isForbidden = error.status === 403;

  // API Gateway replaces the authorizer's error with a generic 403, so the code
  // never reaches us. Ask the one endpoint an MFA-less admin can reach.
  const { data: status } = useQuery<{ mfa: boolean }>({
    queryKey: ["admin", "bootstrap-status"],
    queryFn: () => adminFetch<{ mfa: boolean }>("admin/bootstrap/status", { token: idToken }),
    enabled: isForbidden && Boolean(idToken),
    retry: false,
    staleTime: 0,
  });

  // A missing factor is not a dead end: the account is valid, it just has to
  // enrol. Anything else (no admin group) stays a denial.
  if (status?.mfa === false) {
    return (
      <FullScreen>
        <div className="w-full max-w-sm rounded-[10px] border border-border bg-surface p-5">
          <MfaSetup />
        </div>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      <div className="rounded-[10px] border border-border bg-surface p-5">
        <h1 className="text-[14px] font-medium text-fg">
          {isAuth ? "Session expired" : isForbidden ? "Access denied" : "Admin API error"}
        </h1>

        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {isAuth && "Your token is no longer accepted. Sign in again to continue."}
          {isForbidden &&
            "The API rejected this account. Either it is not in an admin group, or it has no TOTP factor while ADMIN_REQUIRE_MFA is enabled. See the runbook §1 and §2."}
          {!isAuth && !isForbidden && error.message}
        </p>

        {error.requestId && (
          <p className="mono mt-3 text-[10.5px] text-faint">request: {error.requestId}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-8 rounded-[6px] border border-border-strong/60 bg-surface-2 px-3 text-[11.5px] text-fg transition-colors hover:bg-surface-elevated"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => {
              signOut();
              window.location.href = "/login";
            }}
            className="h-8 rounded-[6px] bg-accent px-3 text-[11.5px] font-medium text-white transition-[filter] hover:brightness-110"
          >
            Sign in again
          </button>
        </div>
      </div>
    </FullScreen>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status } = useAdminAuth();
  const me = useAdminMe();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  if (status === "loading" || status === "anonymous") {
    return (
      <FullScreen>
        <p className="text-[12px] text-muted">Checking session…</p>
      </FullScreen>
    );
  }

  if (me.isLoading) {
    return (
      <FullScreen>
        <p className="text-[12px] text-muted">Loading identity…</p>
      </FullScreen>
    );
  }

  if (me.error) {
    return <AccessProblem error={me.error as AdminApiError} />;
  }

  return <AdminShell identity={me.data}>{children}</AdminShell>;
}
