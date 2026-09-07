'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSite } from '@/lib/site';
import { IconOlive } from '@/components/icons';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const { site } = useSite();

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [farmName, setFarmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (user: { role: string }) => {
    router.replace(user.role === 'admin' ? '/admin' : '/');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        const user = await login(username.trim(), password);
        go(user);
      } else {
        if (password.length < 6) {
          setError('パスワードは6文字以上にしてください。');
          setBusy(false);
          return;
        }
        const user = await register({
          username: username.trim(),
          password,
          display_name: displayName.trim() || undefined,
          farm_name: farmName.trim() || undefined,
        });
        go(user);
      }
    } catch (err: any) {
      setError(err?.message || 'エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[#f5f5f5] px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span
            className="grid h-11 w-11 place-items-center rounded-xl text-white"
            style={{ background: site.accent }}
          >
            <IconOlive size={24} className="text-white/90" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight text-neutral-900">{site.name}</p>
            <p className="text-xs text-neutral-400">{site.subtitle}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1">
            <button
              onClick={() => { setMode('login'); setError(null); }}
              className={`rounded-md py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
            >
              ログイン
            </button>
            <button
              onClick={() => { setMode('register'); setError(null); }}
              className={`rounded-md py-2 text-sm font-medium transition-colors ${mode === 'register' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
            >
              農家登録
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {error && (
              <p className="rounded-md bg-health-danger/10 px-3 py-2 text-xs text-health-danger">{error}</p>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">ユーザー名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder="ユーザー名"
                className="input w-full px-3 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">パスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="パスワード"
                className="input w-full px-3 py-2.5 text-sm"
              />
            </div>

            {mode === 'register' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">表示名（任意）</label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="例: 田中 太郎"
                    className="input w-full px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">農園名（任意）</label>
                  <input
                    value={farmName}
                    onChange={(e) => setFarmName(e.target.value)}
                    placeholder="例: 小豆島第1農園"
                    className="input w-full px-3 py-2.5 text-sm"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full py-2.5 text-sm"
            >
              {busy ? '処理中…' : mode === 'login' ? 'ログイン' : '登録する'}
            </button>
          </form>

          {mode === 'login' && (
            <p className="mt-4 text-center text-[11px] text-neutral-400">
              管理者: admin / admin123（初期アカウント）
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
