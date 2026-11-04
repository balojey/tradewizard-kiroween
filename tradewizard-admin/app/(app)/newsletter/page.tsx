import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { CampaignsView } from "@/components/newsletter/CampaignsView";

export default function NewsletterPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading newsletter…" />}>
      <CampaignsView />
    </Suspense>
  );
}
