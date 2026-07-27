import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, resolving Tailwind conflicts in favour of the last one.
 *
 * Without `twMerge`, `cn('px-4', props.className)` where the caller passes `px-6`
 * emits both, and which wins depends on stylesheet order rather than intent. This is
 * what makes every component's `className` prop reliably able to override its defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
