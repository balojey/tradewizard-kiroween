import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { BillingPageShell } from "@/components/billing/BillingPageShell";

export default function BillingPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading billing…" />}>
      <BillingPageShell />
    </Suspense>
  );
}
