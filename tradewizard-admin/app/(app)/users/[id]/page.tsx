import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { UserDetailView } from "@/components/users/UserDetailView";

export default function UserDetailPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading user…" />}>
      <UserDetailView />
    </Suspense>
  );
}
