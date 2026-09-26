'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <div className="grid min-h-screen place-items-center bg-[#f5f5f5] p-6">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
              ⚠️
            </div>
            <h1 className="text-lg font-semibold text-neutral-900">
              画面を表示できませんでした
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">
              予期しないエラーが発生しました。再読み込みをお試しください。
              問題が続く場合はバックエンドの起動状態をご確認ください。
            </p>
            {error?.digest && (
              <p className="mt-3 font-mono text-xs text-neutral-400">{error.digest}</p>
            )}
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => reset()}
                className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-olive-700"
              >
                再読み込み
              </button>
              {/* global-error runs outside the App Router tree, so a plain anchor is required */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                ホームへ
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}