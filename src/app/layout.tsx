import React from 'react';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Instant Project Estimate & Specialist Dispatch',
  description: 'Request an immediate technical quote and direct specialist callback.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-canvas text-ink selection:bg-brand/15 selection:text-ink">
        {children}
      </body>
    </html>
  );
}
