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
  title: 'NorthByte | Profit Scenario Tool',
  description: 'Interactive profit diagnosis for NorthByte Airlines, First Byte 2026.',
  openGraph: {
    title: 'NorthByte | What does it take to stop losing money?',
    description: 'Move the levers and see where profit lands against breakeven.',
    images: [{ url: '/og.png', width: 1792, height: 933 }],
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
