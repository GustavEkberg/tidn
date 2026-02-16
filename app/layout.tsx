import type { Metadata, Viewport } from 'next';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Toaster } from 'sonner';
import './globals.css';
import { Inter } from 'next/font/google';
import { ServiceWorkerRegistration } from './service-worker-registration';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover'
};

export const metadata: Metadata = {
  title: 'tidn',
  description: 'Collaborative timelines for sharing photos, videos, and moments',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'tidn'
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <meta name="theme-color" content="#1a1a1a" />
      </head>
      <body className="antialiased">
        <NuqsAdapter>{children}</NuqsAdapter>
        <Toaster />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
