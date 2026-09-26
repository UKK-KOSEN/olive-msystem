'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function BackendStatusBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const ok = await api.pingHealth();
      if (!alive) return;
      if (ok) {
        setOffline(false);
      } else {
        setOffline(true);
      }
    };
    check();
    const timer = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-4 right-4 z-[100] max-w-sm rounded-xl border border-red-300 bg-red-50 px-4 py-3 shadow-lg"
    >
      <p className="text-sm font-semibold text-red-700">バックエンドに接続できません</p>
      <p className="mt-1 text-xs leading-relaxed text-red-600">
        サーバーが起動しているかご確認ください。復旧すると自動で再表示されます。
      </p>
      <button
        type="button"
        onClick={() => {
          setOffline(false);
          api.pingHealth().then((ok) => {
            setOffline(!ok);
          });
        }}
        className="mt-2 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
      >
        再確認
      </button>
    </div>
  );
}
