import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { AuditView } from "@/components/audit/AuditView";

export default function AuditPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading audit log…" />}>
      <AuditView />
    </Suspense>
  );
}
