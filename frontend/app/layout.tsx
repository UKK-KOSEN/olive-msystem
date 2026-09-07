import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import { SiteProvider } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  title: 'olive-msystem | オリーブ管理ダッシュボード',
  description: 'オリーブの体調を解析・可視化する管理画面',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <SiteProvider>
          <AuthProvider>{children}</AuthProvider>
        </SiteProvider>
      </body>
    </html>
  );
}