import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-medium tracking-tight",
    "transition-[background-color,color,border-color,box-shadow] duration-150",
    "focus-visible:outline-none focus-visible:ring-2",
    "focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-offset-2",
    "focus-visible:ring-offset-[color:var(--focus-ring-offset)]",
    "disabled:cursor-not-allowed disabled:opacity-60",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-[color:var(--accent-primary)] text-[color:var(--fg-inverse)]",
          "hover:bg-[color:var(--accent-primary-hover)]",
          "shadow-[var(--shadow-sm)]",
        ].join(" "),
        secondary: [
          "bg-[color:var(--bg-surface-2)] text-[color:var(--fg-default)]",
          "border border-[color:var(--border-default)]",
          "hover:bg-[color:var(--bg-surface-3)]",
        ].join(" "),
        ghost: [
          "bg-transparent text-[color:var(--fg-default)]",
          "hover:bg-[color:var(--bg-surface-2)]",
        ].join(" "),
        outline: [
          "bg-transparent text-[color:var(--fg-default)]",
          "border border-[color:var(--border-default)]",
          "hover:bg-[color:var(--bg-surface-2)]",
        ].join(" "),
        destructive: [
          "bg-[color:var(--feedback-error-fg)] text-[color:var(--fg-inverse)]",
          "hover:opacity-90",
        ].join(" "),
        link: [
          "bg-transparent text-[color:var(--accent-fg)] underline-offset-4",
          "hover:underline",
        ].join(" "),
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-10 px-5 text-[15px]",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
