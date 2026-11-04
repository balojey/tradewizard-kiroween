import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { CampaignComposer } from "@/components/newsletter/CampaignComposer";

export default function NewsletterCampaignPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading issue…" />}>
      <CampaignComposer />
    </Suspense>
  );
}
