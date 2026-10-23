import { auth } from '@/app/lib/auth';
import { env } from '@/env.mjs';
import { initializeServer } from '@trycompai/analytics/server';
import '@trycompai/design-system/globals.css';
import { cn } from '@trycompai/ui/cn';
import { GeistMono } from 'geist/font/mono';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Suspense } from 'react';
import { Toaster } from 'sonner';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL('https://portal.trycomp.ai'),
  title: 'Comp AI | Employee Portal',
  description: 'Enter your email and one time password to continue',
  twitter: {
    title: 'Comp AI | Employee Portal',
    description: 'Enter your email and one time password to continue',
    images: [
      {
        url: 'https://cdn.trycomp.ai/opengraph-image.jpg',
        width: 800,
        height: 600,
      },
      {
        url: 'https://cdn.trycomp.ai/opengraph-image.jpg',
        width: 1800,
        height: 1600,
      },
    ],
  },
  openGraph: {
    title: 'Comp AI | Employee Portal',
    description: 'Enter your email and one time password to continue',
    url: 'https://portal.trycomp.ai',
    siteName: 'Comp AI',
    images: [
      {
        url: 'https://cdn.trycomp.ai/opengraph-image.jpg',
        width: 800,
        height: 600,
      },
      {
        url: 'https://cdn.trycomp.ai/opengraph-image.jpg',
        width: 1800,
        height: 1600,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)' },
    { media: '(prefers-color-scheme: dark)' },
  ],
};

const font = localFont({
  src: '../../public/fonts/Inter.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--font-general-sans',
});

if (env.NEXT_PUBLIC_POSTHOG_KEY && env.NEXT_PUBLIC_POSTHOG_HOST) {
  initializeServer({
    apiKey: env.NEXT_PUBLIC_POSTHOG_KEY,
    apiHost: env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}

export default async function Layout(props: { children: React.ReactNode }) {
  const { children } = props;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          `${GeistMono.variable} ${font.variable}`,
          'overscroll-none whitespace-pre-line antialiased',
        )}
      >
        <Suspense>
          <NuqsAdapter>
            <Providers session={session}>
              <main>{children}</main>
            </Providers>
          </NuqsAdapter>
        </Suspense>
        <Toaster richColors />
        <footer style={{ padding: '0.5rem 1rem' }}>
          <a href={`${env.NEXT_PUBLIC_API_URL}/v1/source/page`}>Modified Comp source (AGPLv3)</a>
        </footer>
      </body>
    </html>
  );
}
