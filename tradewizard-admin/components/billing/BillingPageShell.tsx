"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BillingView } from "@/components/billing/BillingView";

export function BillingPageShell() {
  const router = useRouter();
  const params = useSearchParams();

  const tab = params.get("tab") === "subscriptions" ? "subscriptions" : "payments";
  const plan = params.get("plan") ?? "";
  const renewal = params.get("renewal") ?? "";

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("cursor");
    const query = next.toString();
    router.replace(query ? `/billing?${query}` : "/billing");
  }

  return (
    <BillingView
      tab={tab}
      onTabChange={(nextTab) => update({ tab: nextTab === "payments" ? null : nextTab })}
      plan={plan}
      renewal={renewal}
      onFilterChange={update}
    />
  );
}
