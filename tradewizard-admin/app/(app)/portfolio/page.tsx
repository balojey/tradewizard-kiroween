import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { PortfolioView } from "@/components/portfolio/PortfolioView";

export default function PortfolioPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading portfolio…" />}>
      <PortfolioView />
    </Suspense>
  );
}
