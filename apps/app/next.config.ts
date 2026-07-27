import type { NextConfig } from 'next';

/**
 * Security headers for the application shell.
 *
 * These are stricter than a typical Next.js default and deliberately so — this app
 * renders member health data, body imagery and financial records. The API sets its own,
 * far more restrictive, policy (see apps/api/src/main.ts); this one has to permit the
 * things a real React application genuinely needs and nothing beyond that.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    // Denies access to hardware the app has no reason to touch. Camera is *not*
    // denied outright — Phase 6 body scan and form analysis need it — but it is
    // restricted to same-origin, so an embedded third party can never request it.
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The design system ships as TypeScript source rather than a build artefact, so a
  // change to a component is reflected without a separate build step in the watch loop.
  transpilePackages: ['@mgc/ui'],

  // A type error must fail the build. Suppressing them "for now" is how a codebase
  // ends up with a thousand of them and no way back. (Next 16 removed the `eslint`
  // config key along with `next lint`; linting is a separate CI step.)
  typescript: { ignoreBuildErrors: false },

  // Hides the framework and version from responses; no reason to advertise the stack.
  poweredByHeader: false,

  images: {
    // Media is served from Cloudflare R2 via signed URLs. Locally that is MinIO.
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'http', hostname: 'localhost', port: '9000' },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
