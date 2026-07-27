'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * When set, the field is styled as invalid *and* wired to its message via
   * aria-describedby. Passing the message rather than a boolean is deliberate: it
   * makes the accessible description impossible to forget, which is the usual
   * failure mode of hand-rolled form fields.
   */
  error?: string;
  iconLeft?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error, iconLeft, id, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className="w-full">
      <div className="relative">
        {iconLeft ? (
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle [&_svg]:size-4"
            aria-hidden="true"
          >
            {iconLeft}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(describedBy, error ? errorId : undefined) || undefined}
          className={cn(
            'w-full h-9 rounded-md bg-raised text-fg text-sm',
            'border border-line px-3',
            'placeholder:text-fg-subtle',
            'transition-[border-color,box-shadow] duration-150',
            'hover:border-line-strong',
            // The focus ring is drawn with box-shadow rather than outline so it can
            // sit flush against the border radius without a gap.
            'focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-inset',
            iconLeft && 'pl-9',
            error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_var(--danger-soft)]',
            className,
          )}
          {...props}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
