'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { fade } from '../lib/motion';
import { Button } from './button';

/**
 * The four states every asynchronous view can be in.
 *
 * Modelled as a discriminated union rather than the usual `{ isLoading, error, data }`
 * triple, because that triple permits states that cannot exist — loading *and* errored,
 * or resolved with neither data nor error — and every component then re-derives the
 * same precedence rules slightly differently.
 */
export type DataViewState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error | { message: string } }
  | { status: 'empty' }
  | { status: 'ready'; data: T };

export interface DataViewProps<T> {
  state: DataViewState<T>;
  /**
   * Required, and required to be shaped like the real content. See the note in
   * skeleton.tsx: a generic grey box that resolves into a table reads as slower than
   * a matched placeholder even when it loads faster.
   */
  skeleton: React.ReactNode;
  /**
   * Required. An empty state is part of the feature, not a polish item — for most
   * users it is the *first* thing they see, before they have any data at all.
   */
  empty: React.ReactNode;
  children: (data: T) => React.ReactNode;
  onRetry?: () => void;
  className?: string;
}

/**
 * Renders exactly one of loading / error / empty / ready.
 *
 * `skeleton` and `empty` are non-optional props on purpose. This is the enforcement
 * mechanism described in docs/ARCHITECTURE.md §9: a view that forgot its empty state
 * fails to compile, rather than shipping and being caught in QA — or not caught at all,
 * because the developer's seed data was never empty.
 */
export function DataView<T>({
  state,
  skeleton,
  empty,
  children,
  onRetry,
  className,
}: DataViewProps<T>) {
  return (
    <div className={cn('relative', className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          // Keying on status is what makes the crossfade happen at all: without it,
          // React reuses the subtree and the content swaps instantly.
          key={state.status}
          variants={fade}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {state.status === 'loading' ? (
            <div role="status" aria-live="polite" aria-busy="true">
              <span className="sr-only">Loading</span>
              {skeleton}
            </div>
          ) : null}

          {state.status === 'error' ? (
            <ErrorState message={state.error.message} {...(onRetry ? { onRetry } : {})} />
          ) : null}

          {state.status === 'empty' ? empty : null}

          {state.status === 'ready' ? children(state.data) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** The action that resolves the emptiness. An empty state without one is a dead end. */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'px-6 py-14 rounded-xl border border-dashed border-line',
        className,
      )}
    >
      {icon ? (
        <div
          className="mb-4 flex size-11 items-center justify-center rounded-xl bg-inset text-fg-subtle [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'px-6 py-14 rounded-xl border border-danger/25 bg-danger-soft/40',
        className,
      )}
    >
      <div
        className="mb-4 flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger"
        aria-hidden="true"
      >
        <AlertTriangle className="size-5" />
      </div>
      <p className="text-lg font-semibold tracking-tight">Something went wrong</p>
      <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry} iconLeft={<RefreshCw />}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
