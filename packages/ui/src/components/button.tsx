'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  // Base. `select-none` and `active:scale` are what make a button feel like a
  // physical control rather than a link with a background.
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap select-none',
    'font-medium rounded-md',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150',
    'ease-[cubic-bezier(0.22,1,0.36,1)]',
    'active:scale-[0.985]',
    'disabled:pointer-events-none disabled:opacity-50',
    // Icons inherit size and never shrink when the label wraps.
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-fg-on-accent shadow-xs hover:bg-accent-hover',
        secondary:
          'bg-raised text-fg border border-line shadow-xs hover:bg-hover hover:border-line-strong',
        ghost: 'text-fg-muted hover:bg-hover hover:text-fg',
        danger: 'bg-danger text-white shadow-xs hover:brightness-110',
        // For destructive actions that are not the primary path — reads as a warning
        // without shouting, so the real primary action stays the visual default.
        'danger-soft': 'bg-danger-soft text-danger hover:brightness-95',
        link: 'text-accent underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-10 px-5 text-base',
        // Square, for icon-only buttons. Separate sizes so the icon is optically
        // centred instead of relying on equal horizontal padding.
        'icon-sm': 'size-8',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * Shows a spinner and blocks interaction. Distinct from `disabled` so screen
   * readers announce "busy" rather than "unavailable" — the difference between
   * "wait" and "you can't do this".
   */
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, iconLeft, iconRight, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled === true || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        (iconLeft ?? null)
      )}
      {children}
      {loading ? null : (iconRight ?? null)}
    </button>
  );
});

export { buttonVariants };
