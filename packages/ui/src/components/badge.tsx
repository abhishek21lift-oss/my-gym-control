import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'bg-inset text-fg-muted border-line',
        accent: 'bg-accent-soft text-accent border-transparent',
        success: 'bg-success-soft text-success border-transparent',
        warning: 'bg-warning-soft text-warning border-transparent',
        danger: 'bg-danger-soft text-danger border-transparent',
        info: 'bg-info-soft text-info border-transparent',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * Shows a status dot. Colour alone is not an accessible signal, so badges that
   * convey state should also carry a text label — the dot reinforces, never replaces.
   */
  dot?: boolean;
}

export function Badge({ className, tone, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export { badgeVariants };
