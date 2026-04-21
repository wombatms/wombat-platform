import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
    "text-xs font-medium tracking-tight",
    "transition-colors",
  ].join(" "),
  {
    variants: {
      variant: {
        neutral: [
          "bg-[color:var(--bg-surface-2)] text-[color:var(--fg-default)]",
          "border-[color:var(--border-default)]",
        ].join(" "),
        accent: [
          "bg-[color:var(--accent-soft)] text-[color:var(--accent-fg)]",
          "border-transparent",
        ].join(" "),
        success: [
          "bg-[color:var(--feedback-success-bg)] text-[color:var(--feedback-success-fg)]",
          "border-transparent",
        ].join(" "),
        warn: [
          "bg-[color:var(--feedback-warn-bg)] text-[color:var(--feedback-warn-fg)]",
          "border-transparent",
        ].join(" "),
        error: [
          "bg-[color:var(--feedback-error-bg)] text-[color:var(--feedback-error-fg)]",
          "border-transparent",
        ].join(" "),
        info: [
          "bg-[color:var(--feedback-info-bg)] text-[color:var(--feedback-info-fg)]",
          "border-transparent",
        ].join(" "),
        outline: [
          "bg-transparent text-[color:var(--fg-default)]",
          "border-[color:var(--border-default)]",
        ].join(" "),
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
