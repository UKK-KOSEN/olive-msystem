'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
        ⚠️
      </div>
      <div>
        <h2 className="text-base font-semibold text-neutral-900">
          このページの表示中にエラーが発生しました
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          他の機能は引き続きご利用いただけます。
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-olive-700"
        >
          再試行
        </button>
        <Link
          href="/"
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          ダッシュボードへ
        </Link>
      </div>
    </div>
  );
}