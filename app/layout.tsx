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
  title: 'Northbound | Airline Route Lab',
  description: 'Interactive U.S.–Canada airline route opportunity simulator.',
  openGraph: {
    title: 'Northbound | Which route should we launch next?',
    description: 'U.S.–Canada airline route opportunity simulator.',
    images: [{ url: '/og.png', width: 1792, height: 933 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Northbound | Which route should we launch next?',
    description: 'U.S.–Canada airline route opportunity simulator.',
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
