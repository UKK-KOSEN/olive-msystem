'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useSite } from '@/lib/site';
import { IconOlive } from '@/components/icons';

/**
 * Access forbidden page (403).
 * Shown when a logged-in user has no permission to view a page
 * (e.g. a farmer opening the admin console).
 */
export default function ForbiddenPage() {
  const { user } = useAuth();
  const { site } = useSite();

  return (
    <div className="grid min-h-screen place-items-center bg-[#f5f5f5] px-4">
      <div className="w-full max-w-md text-center">
        <span
          className="mx-auto grid h-16 w-16 place-items-center rounded-2xl text-2xl font-bold text-white"
          style={{ background: site.accent }}
        >
          403
        </span>

        <h1 className="mt-5 text-xl font-bold tracking-tight text-neutral-900">
          アクセスが拒否されました
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          このページは管理者専用のため、現在のアカウントでは閲覧できません。
          {user?.display_name ? `（${user.display_name}）` : ''}
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Link href="/" className="btn-primary px-4 py-2 text-sm">
            <span className="flex items-center gap-1.5">
              <IconOlive size={16} />
              ダッシュボードへ戻る
            </span>
          </Link>
          <Link href="/login" className="btn-ghost px-4 py-2 text-sm">
            ログイン画面へ
          </Link>
        </div>
      </div>
    </div>
  );
}