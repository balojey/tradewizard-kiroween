"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:brightness-110 disabled:opacity-45 border border-transparent",
  secondary:
    "bg-surface-2 text-fg hover:bg-surface-elevated disabled:opacity-45 border border-border-strong/70",
  subtle:
    "bg-accent-soft text-accent hover:bg-accent/20 disabled:opacity-45 border border-accent-line/40",
  ghost:
    "bg-transparent text-muted hover:text-fg hover:bg-surface-2 disabled:opacity-45 border border-transparent",
  danger:
    "bg-no text-[oklch(18%_0.02_25)] font-medium hover:brightness-110 disabled:opacity-45 border border-transparent",
};

const SIZES = {
  sm: "h-7.5 px-2.5 text-[11.5px] gap-1.5 rounded-[6px]",
  md: "h-9 px-3.5 text-[12.5px] gap-2 rounded-[7px]",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,filter] duration-150",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(" ")}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
        />
      )}
      {children}
    </button>
  );
}
