"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AdminAuthProvider } from "./AdminAuthProvider";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Internal tool: "fresh enough" beats "precisely instant", and no
            // background refetch storms while someone is reading a table.
            staleTime: 15_000,
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status ?? 0;
              if (status >= 400 && status < 500) return false;
              return failureCount < 1;
            },
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      <AdminAuthProvider>{children}</AdminAuthProvider>
    </QueryClientProvider>
  );
}
