import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  // Absolute URLs are required for the share card. Point this at the real host
  // at deploy time rather than hard-coding one that may not serve this build.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'NorthByte | Profit Scenario Tool',
  description: 'Interactive profit diagnosis for NorthByte Airlines, First Byte 2026.',
  openGraph: {
    title: 'NorthByte | What does it take to stop losing money?',
    description: 'Move the levers and see where profit lands against breakeven.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'NorthByte profit scenario tool' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NorthByte | What does it take to stop losing money?',
    description: 'Move the levers and see where profit lands against breakeven.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
