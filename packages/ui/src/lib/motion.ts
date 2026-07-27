import type { Transition, Variants } from 'framer-motion';

/**
 * The complete motion vocabulary. Components import from here; they do not invent
 * their own durations or curves.
 *
 * This is the difference between an interface that is animated and one that feels
 * designed. When a dialog, a dropdown and a toast all decelerate on the same curve
 * over the same duration, the product reads as a single object. When each picks its
 * own numbers, it reads as several products stitched together — which is precisely
 * how most admin panels feel.
 *
 * Durations are short on purpose. Anything past ~300ms on a tool people use for eight
 * hours a day stops being delightful and starts being latency.
 */

export const easing = {
  /** Default for anything entering or settling. Strong, confident deceleration. */
  out: [0.22, 1, 0.36, 1],
  /** For elements that move across the screen and must feel intentional both ends. */
  inOut: [0.83, 0, 0.17, 1],
  /** Slight overshoot. Reserved for elements that should feel physical. */
  spring: [0.16, 1.06, 0.32, 1],
} as const;

export const duration = {
  instant: 0.12,
  fast: 0.18,
  normal: 0.24,
  slow: 0.36,
} as const;

export const transitions = {
  fast: { duration: duration.fast, ease: easing.out },
  normal: { duration: duration.normal, ease: easing.out },
  spring: { duration: duration.normal, ease: easing.spring },
  /** For layout changes, where a real spring reads better than a fixed curve. */
  layout: { type: 'spring', stiffness: 400, damping: 34, mass: 0.8 },
} satisfies Record<string, Transition>;

/** Fade only. For content swaps where movement would be noise. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.fast },
  exit: { opacity: 0, transition: { duration: duration.instant } },
};

/** Fade with a short rise. The default for cards, panels and page sections. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.normal },
  exit: { opacity: 0, y: 4, transition: { duration: duration.instant } },
};

/** For overlays: scale from near-full so it grows into place rather than zooming. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: transitions.spring },
  exit: { opacity: 0, scale: 0.98, transition: { duration: duration.instant } },
};

/**
 * Staggers children into view.
 *
 * The stagger is small and capped by `staggerChildren` rather than per-item delays:
 * a list of forty members must not take four seconds to finish appearing.
 */
export const staggerContainer = (stagger = 0.035): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren: 0.02 } },
});
