'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const nav: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: '/admin',
    label: '管理ダッシュボード',
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
    href: '/algorithm',
    label: 'システム構成・バージョン',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-9-9" />
        <path d="M21 3 12 12" />
        <path d="M21 3h-6" />
        <path d="M21 3v6" />
      </svg>
    ),
  },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-neutral-200 bg-neutral-900 text-white md:w-60">
      <div className="flex items-center gap-2.5 px-3 py-5 md:px-5">
        <img
          src="/characters/happy.png"
          alt="管理画面"
          className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
        />
        <span className="hidden md:block">
          <span className="block text-[15px] font-semibold tracking-tight">管理画面</span>
          <span className="block text-[11px] text-neutral-400">olive-msystem Admin</span>
        </span>
      </div>

      <div className="px-2 md:px-3">
        <button
          onClick={() => router.back()}
          className="mb-1 flex w-full items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-700 md:px-3"
          title="前のページへ戻る"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
          <span className="hidden md:block">前のページへ戻る</span>
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2 md:px-3">
        {nav.map((n) => {
          const active = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors md:px-3 ${
                active ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
              }`}
            >
              <span className={active ? 'text-white' : 'text-neutral-500'}>{n.icon}</span>
              <span className="hidden md:block">{n.label}</span>
            </Link>
          );
        })}

        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white md:px-3"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9 12 2l9 7" />
            <path d="M5 10v10h14V10" />
            <path d="M9 20v-6h6v6" />
          </svg>
          <span className="hidden md:block">ユーザーUIへ戻る</span>
        </Link>
      </nav>

      <div className="border-t border-neutral-700 p-3 md:p-4">
        <div className="rounded-lg bg-neutral-800 p-2.5">
          <p className="truncate text-xs font-medium text-neutral-100">
            {user?.display_name || user?.username || '管理者'}
          </p>
          <p className="text-[10px] text-neutral-400">管理者</p>
        </div>
        <button
          onClick={handleLogout}
          className="mt-2 w-full rounded-md border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-[10px] text-neutral-300 hover:bg-neutral-700"
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}
