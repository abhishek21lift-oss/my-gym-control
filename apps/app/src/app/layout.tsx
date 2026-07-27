import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '@mgc/ui';
import './globals.css';

const sans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  // `swap` shows fallback text immediately rather than blocking paint on the font.
  // A reception desk checking someone in should never wait on a typeface.
  display: 'swap',
});

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'MY GYM CONTROL',
    template: '%s · MY GYM CONTROL',
  },
  description: 'AI-powered Gym Operating System.',
  // The authenticated app must never be indexed.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'MY GYM CONTROL' },
};

export const viewport: Viewport = {
  // Matches the --bg-base token in each theme so the mobile browser chrome blends
  // into the page instead of framing it with a mismatched bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfc' },
    { media: '(prefers-color-scheme: dark)', color: '#141519' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Zoom is deliberately NOT disabled. Blocking it is an accessibility failure, and
  // the layout is built to tolerate it.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required by next-themes: it writes the theme class
    // onto <html> in a pre-hydration script, so the server and client markup
    // legitimately differ on this one element.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
