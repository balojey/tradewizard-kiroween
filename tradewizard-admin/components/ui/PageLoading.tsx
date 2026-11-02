export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-[12px] text-muted">
      <span
        aria-hidden
        className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
      />
      {label}
    </div>
  );
}
