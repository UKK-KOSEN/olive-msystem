'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    console.error('Admin error boundary caught:', error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4" aria-live="assertive" role="alert">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-health-danger/10 text-2xl">
          ⚠️
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">管理画面でエラーが発生しました</h2>
        <p className="mt-2 text-sm text-neutral-500">
          一時的な問題の可能性があります。再読み込みをお試しください。
        </p>
        {isAdmin && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-700">
              エラー詳細（管理者のみ）
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-left text-[11px] text-neutral-700">
              {error.message}
              {error.digest ? `\nDigest: ${error.digest}` : ''}
            </pre>
          </details>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="btn-primary"
          >
            再読み込み
          </button>
          <button
            type="button"
            onClick={() => { window.location.href = '/admin'; }}
            className="btn-secondary"
          >
            管理画面へ
          </button>
        </div>
      </div>
    </div>
  );
}
