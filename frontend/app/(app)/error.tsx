'use client';

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error boundary caught:', error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-health-danger/10 text-2xl">
          ⚠️
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">表示中にエラーが発生しました</h2>
        <p className="mt-2 text-sm text-neutral-500">
          一時的な問題の可能性があります。再読み込みをお試しください。
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => reset()}
            className="btn-primary"
          >
            再読み込み
          </button>
          <button
            onClick={() => { window.location.href = '/'; }}
            className="btn-secondary"
          >
            ダッシュボードへ
          </button>
        </div>
      </div>
    </div>
  );
}
