import type { Metadata } from 'next';
import { Public_Sans } from 'next/font/google';
import './globals.css';
import { Shell } from '../components/Shell';
import { AuthProvider } from '../components/auth';

/* One family, as the design system specifies. Figures are set in it too, with
   tabular-nums — mono is reserved for code and appears nowhere in the UI. */
const sans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-public-sans',
});

export const metadata: Metadata = {
  title: 'Real Estate Investor Toolkit',
  description:
    'A growing toolkit for real-estate investors — underwrite rentals, size up financing, and keep every deal in one place.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
      </body>
    </html>
  );
}
