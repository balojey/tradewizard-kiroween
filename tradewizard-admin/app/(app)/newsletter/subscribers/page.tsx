import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { SubscribersView } from "@/components/newsletter/SubscribersView";

export default function NewsletterSubscribersPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading subscribers…" />}>
      <SubscribersView />
    </Suspense>
  );
}
