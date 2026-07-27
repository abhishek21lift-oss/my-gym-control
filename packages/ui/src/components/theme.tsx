'use client';

import { ThemeProvider as NextThemeProvider, useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Transitions are suppressed during the switch itself. Without this, every
      // colour-carrying element animates simultaneously and the theme change reads as
      // a slow smear rather than an instant flip.
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

/**
 * A three-way segmented control, not a two-way toggle.
 *
 * "System" is a distinct choice, not the absence of one: a user who has never touched
 * this wants the OS setting to keep applying when it changes at sunset. Collapsing it
 * into a binary silently opts them out of that forever.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // The server cannot know the client's resolved theme, so rendering the active state
  // before mount would produce a hydration mismatch and a flash of the wrong selection.
  React.useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn('inline-flex items-center gap-0.5 rounded-lg bg-inset p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex size-7 items-center justify-center rounded-[0.4rem]',
              'transition-colors duration-150',
              active
                ? 'bg-raised text-fg shadow-xs'
                : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
