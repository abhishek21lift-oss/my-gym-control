import * as React from 'react';
import { cn } from '../lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `flat` for cards sitting inside another surface, `raised` for standalone panels.
   * Depth is a token, not a per-card judgement call — which is what stops a dashboard
   * accumulating six subtly different shadow treatments.
   */
  elevation?: 'flat' | 'raised' | 'floating';
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, elevation = 'raised', interactive = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-raised border border-line rounded-xl',
        elevation === 'flat' && 'shadow-none',
        elevation === 'raised' && 'shadow-sm',
        elevation === 'floating' && 'shadow-lg',
        interactive &&
          'transition-[box-shadow,border-color,transform] duration-200 ' +
            'ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-md hover:border-line-strong ' +
            'hover:-translate-y-px cursor-pointer',
        className,
      )}
      {...props}
    />
  );
});

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1 p-5 pb-0', className)} {...props} />;
  },
);

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return <h3 ref={ref} className={cn('text-lg font-semibold tracking-tight', className)} {...props} />;
});

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-sm text-fg-muted', className)} {...props} />;
});

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('p-5', className)} {...props} />;
  },
);

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('flex items-center gap-2 p-5 pt-0', className)}
        {...props}
      />
    );
  },
);
