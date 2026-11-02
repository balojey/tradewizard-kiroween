import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { SessionDetailView } from "@/components/portfolio/SessionDetailView";

export default function SessionDetailPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading session…" />}>
      <SessionDetailView />
    </Suspense>
  );
}
