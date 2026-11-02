"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { forwardRef, useId } from "react";

const CONTROL =
  "w-full rounded-[7px] border bg-field text-[12.5px] text-fg transition-colors " +
  "placeholder:text-faint focus:border-accent focus:outline-none " +
  "focus:shadow-[0_0_0_3px_var(--ring)] disabled:opacity-50";

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}

function FieldShell({ label, hint, error, htmlFor, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[11.5px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[11px] text-no">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[11px] text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, mono = false, id, className = "", ...rest },
  ref
) {
  const generated = useId();
  const inputId = id ?? `input-${generated}`;

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={inputId}>
      <input
        {...rest}
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
        className={[
          CONTROL,
          "h-9 px-2.5",
          error ? "border-no" : "border-border-strong/70",
          mono ? "mono tracking-[0.22em]" : "",
          className,
        ].join(" ")}
      />
    </FieldShell>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id, className = "", rows = 3, ...rest },
  ref
) {
  const generated = useId();
  const inputId = id ?? `textarea-${generated}`;

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={inputId}>
      <textarea
        {...rest}
        id={inputId}
        ref={ref}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
        className={[
          CONTROL,
          "resize-y px-2.5 py-2 leading-relaxed",
          error ? "border-no" : "border-border-strong/70",
          className,
        ].join(" ")}
      />
    </FieldShell>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, id, className = "", children, ...rest },
  ref
) {
  const generated = useId();
  const inputId = id ?? `select-${generated}`;

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={inputId}>
      <select
        {...rest}
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
        className={[
          CONTROL,
          "ui-select h-9 pl-2.5 pr-8",
          error ? "border-no" : "border-border-strong/70",
          className,
        ].join(" ")}
      >
        {children}
      </select>
    </FieldShell>
  );
});
