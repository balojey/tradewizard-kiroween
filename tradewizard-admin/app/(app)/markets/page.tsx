import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { MarketsView } from "@/components/markets/MarketsView";

export default function MarketsPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading markets…" />}>
      <MarketsView />
    </Suspense>
  );
}
