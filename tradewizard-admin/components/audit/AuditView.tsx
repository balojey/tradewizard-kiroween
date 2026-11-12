"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { DataTable, type Column } from "@/components/data/DataTable";
import {
  ClearFilters,
  DateFilter,
  Pagination,
  SearchInput,
  SelectFilter,
  Toolbar,
} from "@/components/data/Filters";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyableId, TimeCell } from "@/components/domain/Primitives";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { fetchAuditExport, useAudit, useVerifyAuditChain, type AuditFilters } from "@/hooks/useAudit";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { formatDateTime } from "@/lib/format";
import type { AuditEntry, AuditVerification } from "@/types/admin";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

/**
 * Why a chain can break. The wording matters: an operator reading this has to
 * know whether they are looking at an upgrade artefact or at evidence.
 */
const BROKEN_REASONS: Record<string, string> = {
  missing_row_hash: "This row was written before the chain existed and was never backfilled.",
  unsupported_hash_version: "This row uses a hash version this portal does not know how to check.",
  row_hash_mismatch: "A hashed field was edited after the row was written.",
  prev_hash_mismatch: "This row does not link to the row before it — a fork or a reordering.",
  chain_start_mismatch: "The first row of the log does not start the chain.",
  unexpected_completion: "A pending row carries completion fields.",
  missing_completion: "A terminal row has no completion hash.",
  completion_hash_mismatch: "The completion state was edited after the row was written.",
};

function Summary({ entry }: { entry: AuditEntry }) {
  const payload = (entry.after ?? entry.before) as Record<string, unknown> | null;
  if (!payload) return <span className="text-faint">—</span>;

  const text = Object.entries(payload)
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");

  return (
    <span className="mono block max-w-[280px] truncate text-[10.5px] text-faint" title={text}>
      {text}
    </span>
  );
}

function hashCell(value: string | null) {
  if (!value) return <span className="text-[10.5px] text-faint">unsealed</span>;

  return <span className="mono text-[10.5px] text-muted">{value.slice(0, 10)}…</span>;
}

function HashLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-b border-border-soft py-1.5 last:border-0">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-faint">{label}</div>
      {value ? (
        <div className="mono select-all break-all text-[11px] text-fg">{value}</div>
      ) : (
        <div className="text-[11px] text-faint">—</div>
      )}
    </div>
  );
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: Array<{ header: string; value: (row: AuditEntry) => unknown }> = [
  { header: "id", value: (row) => row.id },
  { header: "created_at", value: (row) => row.createdAt },
  { header: "completed_at", value: (row) => row.completedAt },
  { header: "actor_sub", value: (row) => row.actorSub },
  { header: "actor_email", value: (row) => row.actorEmail },
  { header: "actor_role", value: (row) => row.actorRole },
  { header: "action", value: (row) => row.action },
  { header: "target_type", value: (row) => row.targetType },
  { header: "target_id", value: (row) => row.targetId },
  { header: "status", value: (row) => row.status },
  { header: "reason", value: (row) => row.reason },
  { header: "error", value: (row) => row.error },
  { header: "before", value: (row) => row.before },
  { header: "after", value: (row) => row.after },
  { header: "prev_hash", value: (row) => row.prevHash },
  { header: "row_hash", value: (row) => row.rowHash },
  { header: "completion_hash", value: (row) => row.completionHash },
  { header: "hash_version", value: (row) => row.hashVersion },
];

function toCsv(rows: AuditEntry[]): string {
  const header = CSV_COLUMNS.map((column) => csvCell(column.header)).join(",");
  const body = rows.map((row) => CSV_COLUMNS.map((column) => csvCell(column.value(row))).join(","));
  return [header, ...body].join("\n");
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const COLUMNS: Column<AuditEntry>[] = [
  { key: "when", header: "When", render: (row) => <TimeCell value={row.createdAt} /> },
  {
    key: "action",
    header: "Action",
    render: (row) => <span className="mono text-[11px] text-fg">{row.action}</span>,
  },
  {
    key: "actor",
    header: "Actor",
    render: (row) => (
      <span className="flex flex-col">
        <span className="truncate text-[11.5px]">{row.actorEmail}</span>
        <span className="text-[10px] uppercase tracking-[0.07em] text-faint">{row.actorRole}</span>
      </span>
    ),
  },
  {
    key: "target",
    header: "Target",
    render: (row) => (
      <span className="flex flex-col gap-0.5">
        <span className="text-[10.5px] uppercase tracking-[0.05em] text-faint">{row.targetType}</span>
        <CopyableId value={row.targetId} label="target id" chars={8} />
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <Badge
        dot
        tone={row.status === "succeeded" ? "yes" : row.status === "failed" ? "no" : "warning"}
      >
        {row.status}
      </Badge>
    ),
  },
  {
    key: "reason",
    header: "Reason",
    render: (row) => (
      <span className="block max-w-[200px] truncate text-[11px] text-muted" title={row.reason}>
        {row.reason}
      </span>
    ),
  },
  { key: "detail", header: "Detail", render: (row) => <Summary entry={row} /> },
];

export function AuditView() {
  const router = useRouter();
  const params = useSearchParams();
  const { idToken } = useAdminAuth();

  const filters: AuditFilters = {
    actor: params.get("actor") ?? "",
    action: params.get("action") ?? "",
    targetType: params.get("targetType") ?? "",
    targetId: params.get("targetId") ?? "",
    status: params.get("status") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    id: params.get("id") ?? "",
  };

  const [actorTerm, setActorTerm] = useState(filters.actor);
  const [actionTerm, setActionTerm] = useState(filters.action);
  const [targetTerm, setTargetTerm] = useState(filters.targetType);
  const [targetIdTerm, setTargetIdTerm] = useState(filters.targetId);
  const [syncedActor, setSyncedActor] = useState(filters.actor);
  const [syncedAction, setSyncedAction] = useState(filters.action);
  const [syncedTarget, setSyncedTarget] = useState(filters.targetType);
  const [syncedTargetId, setSyncedTargetId] = useState(filters.targetId);

  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  if (filters.actor !== syncedActor) {
    setSyncedActor(filters.actor);
    setActorTerm(filters.actor);
  }
  if (filters.action !== syncedAction) {
    setSyncedAction(filters.action);
    setActionTerm(filters.action);
  }
  if (filters.targetType !== syncedTarget) {
    setSyncedTarget(filters.targetType);
    setTargetTerm(filters.targetType);
  }
  if (filters.targetId !== syncedTargetId) {
    setSyncedTargetId(filters.targetId);
    setTargetIdTerm(filters.targetId);
  }

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("cursor");
    const query = next.toString();
    router.replace(query ? `/audit?${query}` : "/audit");
  }

  useEffect(() => {
    if (actorTerm === filters.actor) return;
    const timer = setTimeout(() => update({ actor: actorTerm || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorTerm]);

  useEffect(() => {
    if (actionTerm === filters.action) return;
    const timer = setTimeout(() => update({ action: actionTerm || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionTerm]);

  useEffect(() => {
    if (targetTerm === filters.targetType) return;
    const timer = setTimeout(() => update({ targetType: targetTerm || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTerm]);

  useEffect(() => {
    if (targetIdTerm === filters.targetId) return;
    const timer = setTimeout(() => update({ targetId: targetIdTerm || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIdTerm]);

  const stack = useCursorStack(JSON.stringify(filters));
  const { data, isLoading, error } = useAudit(filters, stack.cursor);
  const verify = useVerifyAuditChain();

  // A result only describes the window it was run against, so it is keyed by
  // that window: changing filters or paging makes it unverified again rather
  // than letting the badge describe a range nobody is looking at.
  const [checked, setChecked] = useState<{ key: string; result: AuditVerification } | null>(null);
  const windowKey = JSON.stringify({ filters, cursor: stack.cursor });
  const verification = checked && checked.key === windowKey ? checked.result : null;

  // A failed attempt from the previous window must not follow the operator.
  const verifyError =
    verify.isError && verify.variables && JSON.stringify(verify.variables) === JSON.stringify(filters)
      ? (verify.error as Error)
      : null;

  const filtersActive = Boolean(
    filters.actor ||
      filters.action ||
      filters.targetType ||
      filters.targetId ||
      filters.status ||
      filters.from ||
      filters.to ||
      filters.id
  );

  const chainState = !verification ? "unverified" : verification.valid ? "verified" : "broken";

  async function runExport(format: "json" | "csv") {
    setExporting(format);
    setExportNote(null);

    try {
      const payload = await fetchAuditExport(filters, idToken);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const truncation = payload.truncated
        ? ` Capped at ${payload.cappedAt} rows — narrow the filters to export the rest.`
        : "";

      if (format === "json") {
        download(
          JSON.stringify(
            {
              exportedAt: payload.exportedAt,
              truncated: payload.truncated,
              rows: payload.rows,
            },
            null,
            2
          ),
          `audit-${stamp}.json`,
          "application/json"
        );
      } else {
        download(toCsv(payload.rows), `audit-${stamp}.csv`, "text/csv");
      }

      setExportNote(`Exported ${payload.rows.length} row(s).${truncation}`);
    } catch (caught) {
      setExportNote((caught as Error).message);
    } finally {
      setExporting(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Audit"
        description="Append-only record of every admin action. Each row commits to the hash of the row before it, so an edit anywhere breaks the chain at that row — verification names it."
        meta={
          <>
            <span
              title={
                chainState === "verified"
                  ? "The current window was checked against its hashes"
                  : chainState === "broken"
                    ? "Verification found a row that does not match its hash"
                    : "Not checked yet — press Verify chain"
              }
            >
              <Badge
                dot
                tone={chainState === "verified" ? "yes" : chainState === "broken" ? "no" : "neutral"}
              >
                {chainState === "verified" ? (
                  <>
                    <ShieldCheck size={11} aria-hidden /> Chain verified
                  </>
                ) : chainState === "broken" ? (
                  <>
                    <ShieldAlert size={11} aria-hidden /> Chain broken
                  </>
                ) : (
                  <>
                    <ShieldQuestion size={11} aria-hidden /> Not verified
                  </>
                )}
              </Badge>
            </span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>{data ? `${data.items.length} entries on this page` : "—"}</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>newest first</span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              loading={verify.isPending}
              onClick={() => {
                setExportNote(null);
                verify.mutate(filters, { onSuccess: (result) => setChecked({ key: windowKey, result }) });
              }}
            >
              Verify chain
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={exporting === "json"}
              disabled={exporting !== null}
              onClick={() => void runExport("json")}
              title="Download the filtered rows as JSON, including hashes"
            >
              <Download size={13} aria-hidden /> JSON
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={exporting === "csv"}
              disabled={exporting !== null}
              onClick={() => void runExport("csv")}
              title="Download the filtered rows as CSV, including hashes"
            >
              <Download size={13} aria-hidden /> CSV
            </Button>
          </>
        }
      />

      {verification && (
        <Notice
          tone={verification.valid ? "success" : "error"}
          title={
            verification.valid
              ? `Chain verified over ${verification.checked.toLocaleString()} row(s)`
              : `Chain broken at row ${verification.firstBrokenId?.slice(0, 8) ?? "unknown"}`
          }
          className="mb-3"
        >
          {verification.valid ? (
            <>
              Checked{" "}
              {verification.from && verification.to ? (
                <>
                  <span className="mono text-[11px]">{formatDateTime(verification.from)}</span> →{" "}
                  <span className="mono text-[11px]">{formatDateTime(verification.to)}</span>
                </>
              ) : (
                "an empty window"
              )}
              . Head <span className="mono text-[11px]">{verification.head ?? "—"}</span>.
              {!verification.coversGenesis && (
                <> The window starts mid-chain, so the link to the preceding row was not checked.</>
              )}
            </>
          ) : (
            <>
              {BROKEN_REASONS[verification.firstBrokenReason ?? ""] ??
                verification.firstBrokenReason}
              {" "}
              Export the rows before changing anything: this is evidence, and re-sealing it
              destroys it.
            </>
          )}
          <span className="ml-1 text-faint">
            Verified {formatDateTime(verification.verifiedAt)}.
          </span>
        </Notice>
      )}

      {verifyError && (
        <Notice tone="error" title="Verification could not run" className="mb-3">
          {verifyError.message}
        </Notice>
      )}

      {exportNote && (
        <Notice tone="info" className="mb-3">
          {exportNote}
        </Notice>
      )}

      <div className="mb-4">
        <CopilotPanel
          kind="incident"
          title="Ask about this timeline"
          description="Warden reads the same audit rows this view is filtered to, plus bounded operational metrics, then cites the exact rows it used. It cannot change anything."
          context={{
            from: filters.from || undefined,
            to: filters.to || undefined,
            targetType: filters.targetType || undefined,
            targetId: filters.targetId || undefined,
          }}
          placeholder="e.g. What changed for this user?"
          prompts={[
            {
              label: "What changed in the last hour?",
              question: "What changed in the last hour, and what should I look at first?",
              windowHours: 1,
            },
            {
              label: "Who changed settings this week?",
              question: "Who changed runtime settings this week, and what did they change?",
              windowHours: 168,
            },
            {
              label: "Build a timeline",
              question:
                "Build a timeline for this incident: what changed, who did it, what the result was, and where the evidence sits.",
            },
          ]}
        />
      </div>

      <Toolbar
        right={          <ClearFilters
            active={filtersActive}
            onClick={() => {
              setActorTerm("");
              setActionTerm("");
              setTargetTerm("");
              setTargetIdTerm("");
              router.replace("/audit");
            }}
          />
        }
      >
        <SearchInput label="Actor" value={actorTerm} onChange={setActorTerm} placeholder="Email or sub" />
        <SearchInput
          label="Action"
          value={actionTerm}
          onChange={setActionTerm}
          placeholder="user.note.create"
        />
        <SearchInput
          label="Target type"
          value={targetTerm}
          onChange={setTargetTerm}
          placeholder="user, analysis, session"
        />
        <SearchInput
          label="Target id"
          value={targetIdTerm}
          onChange={setTargetIdTerm}
          placeholder="Exact id"
        />
        <SelectFilter
          label="Status"
          value={filters.status}
          options={STATUS_OPTIONS}
          onChange={(value) => update({ status: value || null })}
        />
        <DateFilter
          label="From"
          value={filters.from}
          onChange={(value) => update({ from: value || null })}
        />
        <DateFilter
          label="To"
          value={filters.to}
          onChange={(value) => update({ to: value || null })}
        />
      </Toolbar>

      {error && (
        <Notice tone="error" title="Could not load the audit log" className="mb-3">
          {(error as Error).message}
        </Notice>
      )}

      <DataTable
        columns={[
          ...COLUMNS,
          {
            key: "hash",
            header: "Hash",
            render: (row) => (
              <button
                type="button"
                onClick={() => setSelected(row)}
                className="mono rounded-[3px] text-[10.5px] text-muted transition-colors hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-line"
                title="Show this row's chain hashes"
              >
                {hashCell(row.rowHash)}
              </button>
            ),
          },
        ]}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage={filtersActive ? "No audit entries match these filters." : "No audit rows yet."}
        emptyHint={
          filtersActive
            ? "Try a shorter action prefix, a wider date range, or clear the status filter."
            : "Every admin mutation writes a row before it runs."
        }
      />

      <Pagination
        hasNext={Boolean(data?.nextCursor)}
        canPrev={stack.canPrev}
        loading={isLoading}
        onNext={() => data?.nextCursor && stack.next(data.nextCursor)}
        onPrev={stack.prev}
      />

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Audit row"
        description={
          selected
            ? `${selected.action} · ${selected.actorEmail} · ${formatDateTime(selected.createdAt)}`
            : undefined
        }
        size="lg"
        footer={
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected && (
          <div className="flex flex-col gap-3">
            <div className="grid gap-x-6 sm:grid-cols-2">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.06em] text-faint">Row id</div>
                <div className="mono select-all break-all text-[11px] text-fg">{selected.id}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.06em] text-faint">Status</div>
                <Badge
                  dot
                  tone={
                    selected.status === "succeeded"
                      ? "yes"
                      : selected.status === "failed"
                        ? "no"
                        : "warning"
                  }
                >
                  {selected.status}
                </Badge>
              </div>
            </div>

            <div>
              <HashLine label="Row hash (sha256)" value={selected.rowHash} />
              <HashLine label="Previous row hash" value={selected.prevHash} />
              <HashLine label="Completion hash (sha256)" value={selected.completionHash} />
              <HashLine
                label="Hash version"
                value={selected.hashVersion === null ? null : String(selected.hashVersion)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.06em] text-faint">Before</div>
                <pre className="mono max-h-40 overflow-auto rounded-[6px] border border-border bg-surface-2 p-2 text-[10.5px] leading-relaxed text-muted">
                  {selected.before ? JSON.stringify(selected.before, null, 2) : "—"}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.06em] text-faint">After</div>
                <pre className="mono max-h-40 overflow-auto rounded-[6px] border border-border bg-surface-2 p-2 text-[10.5px] leading-relaxed text-muted">
                  {selected.after ? JSON.stringify(selected.after, null, 2) : "—"}
                </pre>
              </div>
            </div>

            {selected.error && (
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.06em] text-faint">Error</div>
                <div className="text-[11.5px] text-no">{selected.error}</div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </Page>
  );
}
