import type { Metadata } from 'next';
import { Fraunces, Public_Sans, Spline_Sans_Mono } from 'next/font/google';
import './globals.css';
import { Shell } from '../components/Shell';

const display = Fraunces({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-display' });
const sans = Public_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' });
const mono = Spline_Sans_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Real Estate Investor Toolkit',
  description:
    'A growing toolkit for real-estate investors — underwrite rentals, size up financing, and keep every deal in one place.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <div className="wrap">
          <Shell />
          {children}
        </div>
      </body>
    </html>
  );
}
