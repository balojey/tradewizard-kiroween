import { Suspense } from "react";
import { PageLoading } from "@/components/ui/PageLoading";
import { UsersView } from "@/components/users/UsersView";

export default function UsersPage() {
  return (
    <Suspense fallback={<PageLoading label="Loading users…" />}>
      <UsersView />
    </Suspense>
  );
}
