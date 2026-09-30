import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-parchment placeholder:text-parchment-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
