import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
  {
    variants: {
      variant: {
        primary: "bg-crimson text-parchment hover:bg-crimson-bright shadow-card",
        gold: "bg-gold text-ink hover:bg-gold-bright shadow-card",
        secondary: "bg-surface-raised text-parchment border border-surface-border hover:bg-surface",
        ghost: "text-parchment-dim hover:text-parchment hover:bg-surface-raised",
        danger: "bg-danger text-parchment hover:brightness-110",
        outline: "border border-surface-border text-parchment hover:bg-surface-raised",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
