"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

const CONTROL_CLASS =
  "h-8 rounded-[6px] border border-border-strong/60 bg-field text-[12px] text-fg " +
  "transition-colors placeholder:text-faint focus:border-accent focus:outline-none " +
  "focus:shadow-[0_0_0_3px_var(--ring)]";

export function Toolbar({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-1 flex-wrap items-end gap-2">{children}</div>
      {right && <div className="flex items-center gap-2 pb-0.5">{right}</div>}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <Toolbar>{children}</Toolbar>;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="flex min-w-[220px] flex-1 flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.07em] text-faint">{label}</span>
      <span className="relative block">
        <Search
          size={13}
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={[CONTROL_CLASS, "w-full pl-8 pr-7"].join(" ")}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[4px] p-1 text-faint hover:bg-surface-2 hover:text-fg"
          >
            <X size={11} aria-hidden />
          </button>
        )}
      </span>
    </label>
  );
}

export function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.07em] text-faint">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={[CONTROL_CLASS, "ui-select min-w-[132px] pl-2.5 pr-7"].join(" ")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ToggleFilter({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={[
        "flex h-8 cursor-pointer select-none items-center gap-2 rounded-[6px] border px-2.5 text-[11.5px] transition-colors",
        checked
          ? "border-accent-line/50 bg-accent-soft text-accent"
          : "border-border-strong/60 bg-field text-muted hover:text-fg",
      ].join(" ")}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3 w-3 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

export function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.07em] text-faint">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={[CONTROL_CLASS, "w-[142px] px-2"].join(" ")}
      />
    </label>
  );
}

export function ClearFilters({ onClick, active }: { onClick: () => void; active: boolean }) {  if (!active) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-px flex h-8 items-center gap-1 rounded-[6px] px-2 text-[11.5px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <X size={11} aria-hidden />
      Clear
    </button>
  );
}

export function Pagination({
  hasNext,
  canPrev,
  onNext,
  onPrev,
  loading = false,
}: {
  hasNext: boolean;
  canPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
  loading?: boolean;
}) {
  return (
    <div className="mt-2.5 flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev || loading}
        className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong/60 bg-surface px-2 text-[11.5px] text-fg transition-colors hover:bg-surface-2 disabled:opacity-40"
      >
        <ChevronLeft size={12} aria-hidden />
        Previous
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext || loading}
        className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-border-strong/60 bg-surface px-2 text-[11.5px] text-fg transition-colors hover:bg-surface-2 disabled:opacity-40"
      >
        Next
        <ChevronRight size={12} aria-hidden />
      </button>
    </div>
  );
}
