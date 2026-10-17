import '@sanad/design-tokens/tokens.css';
import '@sanad/ui/ui.css';
import './app.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Sanad', template: '%s · Sanad' },
  robots: { index: false, follow: false },
};

// English UI in the MVP; dir is set per document so Arabic UI can follow.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
