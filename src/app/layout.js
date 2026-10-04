import { AntdRegistry } from '@ant-design/nextjs-registry';
import Providers from '@/components/Providers';
import './globals.css';

export const metadata = {
  title: 'Trust Manager – Donation & Accounting',
  description: 'Trust donation, expense, accounting, audit & compliance management panel',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
