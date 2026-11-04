import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { SupportTicketView } from "@/components/support/SupportTicketView";

export default function SupportTicketPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading ticket…" />}>
      <SupportTicketView />
    </Suspense>
  );
}
