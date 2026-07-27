'use client';

import * as React from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataView,
  type DataViewState,
  EmptyState,
  Input,
  Skeleton,
  SkeletonText,
  ThemeToggle,
} from '@mgc/ui';
import { Dumbbell, Plus, Search, Trash2, UserPlus } from 'lucide-react';

/**
 * The living reference for the design system.
 *
 * This exists because a design system that is only visible inside features cannot be
 * reviewed as a system. Every token and primitive is rendered here in both themes, so a
 * regression — a shadow that stopped following the theme, an accent that goes muddy in
 * dark mode — is visible on one screen instead of being discovered in a feature months
 * later.
 *
 * It is also the page that proves Phase 0's exit criterion: tokens render correctly in
 * both light and dark.
 */

interface DemoMember {
  id: string;
  name: string;
  plan: string;
}

const DEMO_MEMBERS: DemoMember[] = [
  { id: '1', name: 'Aarav Sharma', plan: 'Annual · PT' },
  { id: '2', name: 'Priya Nair', plan: 'Quarterly' },
  { id: '3', name: 'Rohan Mehta', plan: 'Monthly' },
];

const STATES = ['loading', 'error', 'empty', 'ready'] as const;
type StateName = (typeof STATES)[number];

function buildState(name: StateName): DataViewState<DemoMember[]> {
  switch (name) {
    case 'loading':
      return { status: 'loading' };
    case 'error':
      return { status: 'error', error: { message: 'Could not reach the server.' } };
    case 'empty':
      return { status: 'empty' };
    case 'ready':
      return { status: 'ready', data: DEMO_MEMBERS };
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-fg-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Swatch({ label, className }: { label: string; className: string }) {
  return (
    <div className="space-y-1.5">
      <div className={`h-14 rounded-lg border border-line ${className}`} />
      <p className="text-2xs text-fg-subtle">{label}</p>
    </div>
  );
}

export function DesignReference() {
  const [stateName, setStateName] = React.useState<StateName>('ready');

  return (
    <div className="mx-auto max-w-5xl px-6 py-14 space-y-14">
      <header className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <Badge tone="accent" dot>
            Phase 0
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">Design system</h1>
          <p className="max-w-xl text-sm text-fg-muted">
            Every colour, radius, shadow and easing value in the product is defined once in{' '}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-xs">
              packages/ui/src/styles/globals.css
            </code>
            . Switch the theme to verify the palette holds in both.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Section
        title="Surfaces"
        description="Four levels, so depth can be expressed without drawing a border around everything."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Swatch label="base" className="bg-base" />
          <Swatch label="raised" className="bg-raised" />
          <Swatch label="overlay" className="bg-overlay" />
          <Swatch label="inset" className="bg-inset" />
          <Swatch label="hover" className="bg-hover" />
        </div>
      </Section>

      <Section
        title="Accent and semantics"
        description="One accent, used sparingly. Semantic colours are paired with a soft tint so status reads as a hint rather than an alarm."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Swatch label="accent" className="bg-accent" />
          <Swatch label="success" className="bg-success" />
          <Swatch label="warning" className="bg-warning" />
          <Swatch label="danger" className="bg-danger" />
          <Swatch label="info" className="bg-info" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success" dot>
            Active
          </Badge>
          <Badge tone="warning" dot>
            Expiring
          </Badge>
          <Badge tone="danger" dot>
            Overdue
          </Badge>
          <Badge tone="info">Trial</Badge>
        </div>
      </Section>

      <Section
        title="Elevation"
        description="Layered shadows — a tight contact shadow plus a wide ambient one. A single large blur reads as fog."
      >
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((level) => (
            <div key={level} className="space-y-1.5">
              <div className={`h-14 rounded-lg bg-raised border border-line shadow-${level}`} />
              <p className="text-2xs text-fg-subtle">shadow-{level}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Typography"
        description="A tight scale with optical letter-spacing. Numerals are tabular everywhere, so figures in a table align."
      >
        <Card>
          <CardContent className="space-y-3">
            <p className="text-4xl font-semibold tracking-tight">₹4,82,150</p>
            <p className="text-2xl font-semibold tracking-tight">Monthly recurring revenue</p>
            <p className="text-lg">Body text at reading size for longer explanations.</p>
            <p className="text-sm text-fg-muted">Secondary text for supporting detail.</p>
            <p className="text-xs text-fg-subtle">Captions, timestamps and metadata.</p>
            <p className="font-mono text-sm">019fa562-f395-7625-9ace-cb53a9050a30</p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Buttons" description="Six variants and five sizes, with a loading state distinct from disabled.">
        <div className="flex flex-wrap items-center gap-3">
          <Button iconLeft={<Plus />}>Add member</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" iconLeft={<Trash2 />}>
            Delete
          </Button>
          <Button variant="danger-soft">Cancel plan</Button>
          <Button variant="link">Learn more</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="secondary" aria-label="Search">
            <Search />
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section
        title="Inputs"
        description="The error message is a prop, not a boolean — which makes the accessible description impossible to omit."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input placeholder="Search members" iconLeft={<Search />} aria-label="Search members" />
          <Input placeholder="you@gym.com" defaultValue="not-an-email" error="Enter a valid email address." aria-label="Email" />
        </div>
      </Section>

      <Section
        title="DataView"
        description="Loading, error, empty and ready. The skeleton and empty state are required props, so a view that forgot one fails to compile."
      >
        <div className="flex flex-wrap gap-2">
          {STATES.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={stateName === name ? 'primary' : 'secondary'}
              onClick={() => setStateName(name)}
            >
              {name}
            </Button>
          ))}
        </div>

        <Card elevation="flat">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>Rendering the “{stateName}” state.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataView
              state={buildState(stateName)}
              onRetry={() => setStateName('ready')}
              skeleton={
                // Matched to the real row layout below, so resolving causes no reflow.
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="size-9 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-40" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              }
              empty={
                <EmptyState
                  icon={<Dumbbell />}
                  title="No members yet"
                  description="Add your first member to start tracking attendance, plans and payments."
                  action={<Button iconLeft={<UserPlus />}>Add member</Button>}
                />
              }
            >
              {(members) => (
                <ul className="space-y-3">
                  {members.map((member) => (
                    <li key={member.id} className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-accent">
                        {member.name
                          .split(' ')
                          .map((part) => part.charAt(0))
                          .join('')}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{member.name}</p>
                        <p className="text-xs text-fg-muted">{member.plan}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DataView>
          </CardContent>
        </Card>
      </Section>

      <Section title="Skeletons" description="A travelling sheen rather than an opacity pulse — it suggests progress instead of drawing the eye.">
        <Card>
          <CardContent>
            <SkeletonText lines={4} />
          </CardContent>
        </Card>
      </Section>

      <Section title="Cards" description="Elevation is a token, not a per-card judgement call.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card elevation="flat">
            <CardHeader>
              <CardTitle>Flat</CardTitle>
              <CardDescription>Inside another surface.</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
          <Card elevation="raised">
            <CardHeader>
              <CardTitle>Raised</CardTitle>
              <CardDescription>Standalone panel.</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
          <Card elevation="floating" interactive>
            <CardHeader>
              <CardTitle>Floating</CardTitle>
              <CardDescription>Hover me.</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        </div>
      </Section>
    </div>
  );
}
