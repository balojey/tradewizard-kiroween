import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { SupportInbox } from "@/components/support/SupportInbox";

export default function SupportPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading support inbox…" />}>
      <SupportInbox />
    </Suspense>
  );
}
