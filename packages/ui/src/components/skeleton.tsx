import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * A loading placeholder.
 *
 * Skeletons must match the shape of the content they stand in for. A generic grey box
 * that resolves into a table causes a visible reflow, which reads as slower than the
 * same load behind a correctly-shaped placeholder — even when it is measurably faster.
 * That is why `DataView` requires callers to supply a bespoke skeleton rather than
 * offering a one-size-fits-all default.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-md bg-inset',
        // A travelling sheen rather than a pulse. Opacity pulsing draws the eye to
        // the placeholder; a sheen suggests progress and reads as calmer.
        'relative overflow-hidden',
        'before:absolute before:inset-0 before:animate-shimmer',
        'before:bg-[linear-gradient(90deg,transparent_0%,var(--bg-hover)_50%,transparent_100%)]',
        'before:bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

/** Convenience: a block of text lines, last one short, as real paragraphs are. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
