import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { AnalysisDetailView } from "@/components/analyses/AnalysisDetailView";

export default function AnalysisDetailPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading analysis…" />}>
      <AnalysisDetailView />
    </Suspense>
  );
}
