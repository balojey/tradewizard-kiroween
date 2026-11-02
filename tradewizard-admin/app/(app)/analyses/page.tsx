import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { AnalysesView } from "@/components/analyses/AnalysesView";

export default function AnalysesPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading analyses…" />}>
      <AnalysesView />
    </Suspense>
  );
}
