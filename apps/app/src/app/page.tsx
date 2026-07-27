import type { Metadata } from 'next';
import { DesignReference } from '@/components/design-reference';

export const metadata: Metadata = {
  title: 'Design system',
};

/**
 * Temporarily the root route.
 *
 * Once Phase 1 lands, `/` redirects to the signed-in user's portal and this reference
 * moves to `/_design`. It is kept reachable rather than deleted: it is how the design
 * system is reviewed as a system, and how theme regressions are caught on one screen.
 */
export default function Page() {
  return <DesignReference />;
}
