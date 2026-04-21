import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border px-3 py-1 text-sm",
          "bg-[color:var(--bg-surface-1)] text-[color:var(--fg-default)]",
          "border-[color:var(--border-default)]",
          "placeholder:text-[color:var(--fg-muted)]",
          "transition-[border-color,box-shadow] duration-150",
          "focus-visible:outline-none focus-visible:border-[color:var(--focus-ring)]",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
