'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSite } from '@/lib/site';
import { IconOlive } from '@/components/icons';

const nav: { href: string; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  {
    href: '/',
    label: 'ダッシュボード',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/images',
    label: '画像解析',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.5-3.5L11 18" />
      </svg>
    ),
  },
  {
    href: '/olive',
    label: 'オリーブの体調',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21v-6" />
        <path d="M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
        <path d="M9 10.5c.8.8 1.8 1.2 3 1.2" />
        <path d="M15 6.5c-.6.6-1 1.4-1.2 2.4" />
      </svg>
    ),
  },
  {
    href: '/tracking',
    label: '観測記録',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </svg>
    ),
  },
  {
    href: '/calendar',
    label: '観測カレンダー',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 2v4" />
        <path d="M16 2v4" />
      </svg>
    ),
  },
  {
    href: '/notifications',
    label: 'お知らせ',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'プロフィール',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    ),
  },
  {
    href: '/algorithm',
    label: '検出アルゴリズム・システム構成',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3 4 8 9 13" />
        <path d="m15 3 5 5-5 5" />
        <path d="M13 21 6 12" />
      </svg>
    ),
  },
  {
    href: '/faq',
    label: 'よくある質問',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 9a2.8 2.8 0 1 1 4.5 2.1c-.9.7-1.7 1.2-1.7 2.4" />
        <path d="M12 17h.01" />
      </svg>
    ),
  },
  {
    href: '/admin',
    label: '管理',
    adminOnly: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 19 4.5-4.5 3 2 5-5 5.5 5.5" />
      </svg>
    ),
  },
];

type Status = 'checking' | 'online' | 'offline';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { site } = useSite();
  const [status, setStatus] = useState<Status>('checking');

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        if (alive) setStatus(res.ok ? 'online' : 'offline');
      } catch {
        if (alive) setStatus('offline');
      }
    };
    check();
    const t = setInterval(check, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-neutral-200 bg-white md:w-60">
      <Link href="/" className="flex items-center gap-2.5 px-3 py-5 md:px-5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg text-white"
          style={{ background: site.accent }}
        >
          <IconOlive size={20} className="text-white/90" />
        </span>
        <span className="hidden md:block">
          <span className="block text-[15px] font-semibold tracking-tight text-neutral-900">
            {site.name}
          </span>
          <span className="block text-[11px] text-neutral-400">{site.subtitle}</span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 px-2 md:px-3">
        {nav.filter((n) => !n.adminOnly || user?.role === 'admin').map((n) => {
          const active = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors md:px-3 ${
                active ? 'text-accent' : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800'
              }`}
              style={active ? { backgroundColor: 'var(--accent-soft)' } : undefined}
            >
              <span className={active ? 'text-accent' : 'text-neutral-400'}>{n.icon}</span>
              <span className="hidden md:block">{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-neutral-100 p-3 md:p-4">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span
            className={`h-2 w-2 rounded-full ${
              status === 'online'
                ? 'bg-health-good'
                : status === 'offline'
                ? 'bg-health-danger'
                : 'bg-neutral-300'
            }`}
          />
          <span className="hidden md:block">
            {status === 'online'
              ? 'バックエンド接続中'
              : status === 'offline'
              ? 'バックエンド未接続'
              : '接続確認中…'}
          </span>
        </div>

        {user && (
          <div className="mt-3 rounded-lg bg-neutral-50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-neutral-800">
                  {user.display_name || user.username}
                </p>
                <p className="text-[10px] text-neutral-400">
                  {user.role === 'admin' ? '管理者' : `農家${user.farm_name ? ` · ${user.farm_name}` : ''}`}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100"
              >
                ログアウト
              </button>
            </div>
          </div>
        )}

        <Link
          href="/algorithm"
          className="mt-2 block rounded-md px-1 py-1 text-[11px] text-neutral-400 transition-colors hover:text-neutral-700"
        >
          <span className="flex items-center gap-1.5">
            <span className="hidden md:inline">olive-msystem</span>
            <span>v1.0.0</span>
            <span className="hidden md:inline">詳しく見る</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
