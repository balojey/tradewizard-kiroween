import { Suspense } from "react";
import { LogoMark } from "@/components/shell/Sidebar";
import { LoginForm } from "@/components/auth/LoginForm";

const FACTS = [
  {
    title: "Every action is audited",
    body: "Grants, suspensions, refunds and session controls are written before the response is sent.",
  },
  {
    title: "Two factors, always",
    body: "Password plus a TOTP code. The API checks group membership on every request.",
  },
  {
    title: "Internal only",
    body: "This portal is never linked from the product and is not indexed.",
  },
];

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[900px] overflow-hidden rounded-[12px] border border-border bg-surface shadow-[0_40px_80px_-40px_oklch(0%_0_0_/_0.9)]">
        <div className="grid lg:grid-cols-[1fr_minmax(0,420px)]">
          <section className="hidden flex-col justify-between gap-10 border-r border-border-soft bg-rail p-8 lg:flex">
            <div>
              <div className="flex items-center gap-2.5">
                <LogoMark size={26} />
                <span className="text-[14px] font-medium text-fg">TradeWizard Warden</span>
              </div>

              <h1 className="mt-8 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-fg">
                Operations control plane
              </h1>
              <p className="mt-2 max-w-[36ch] text-[12.5px] leading-relaxed text-muted">
                The control surface for analyses, accounts, and autonomous portfolio managers.
              </p>
            </div>

            <ul className="flex flex-col gap-4">
              {FACTS.map((fact) => (
                <li key={fact.title} className="border-l border-border-strong pl-3">
                  <p className="text-[12px] font-medium text-fg">{fact.title}</p>
                  <p className="mt-0.5 max-w-[38ch] text-[11.5px] leading-relaxed text-faint">
                    {fact.body}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="p-6 sm:p-8">
            <div className="mb-6 lg:hidden">
              <LogoMark size={24} />
            </div>

            <h2 className="text-[15px] font-medium text-fg">Sign in</h2>
            <p className="mt-1 text-[11.5px] text-muted">
              Use your admin credentials. Access is checked by the API on every request, not by this
              page.
            </p>

            <div className="mt-6">
              <Suspense fallback={<div className="h-48" />}>
                <LoginForm />
              </Suspense>
            </div>

            <p className="mt-8 border-t border-border-soft pt-3 text-[10.5px] leading-relaxed text-faint">
              Lost access or locked out? Ask an owner to check the Members page, or follow the
              runbook&apos;s account-recovery procedure.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
