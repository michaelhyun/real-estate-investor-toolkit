import type { Metadata } from 'next';
import { Source_Sans_3 } from 'next/font/google';
import './globals.css';
import { Shell } from '../components/Shell';
import { AuthProvider } from '../components/auth';

/* One family, the same as the BlueDoor Hub. Figures are set in it too, with
   tabular-nums — mono is reserved for code and appears nowhere in the UI. */
const sans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-source',
});

export const metadata: Metadata = {
  title: 'Investor Toolkit · BlueDoor',
  description:
    'A growing toolkit for real-estate investors — underwrite rentals, size up financing, and keep every deal in one place.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <head>
        {/* BlueDoor's icon set. display=block hides the ligature names until the font is ready. */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons+Round&display=block" />
      </head>
      <body>
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
      </body>
    </html>
  );
}
