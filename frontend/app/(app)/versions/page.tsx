'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, VersionInfo } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';

export default function VersionsPage() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api.versions());
      setError(null);
    } catch {
      setError('バックエンドに接続できません。');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <PageHeader
        title="バージョン情報"
        description="このダッシュボードで使用しているソフトウェアのバージョン一覧です。"
      />

      {error && (
        <div className="card mb-6 text-sm text-health-danger">{error}</div>
      )}

      {info && (
        <>
          <section className="card mb-6">
            <h2 className="label mb-4">アプリケーション</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <VersionItem label="olive-msystem フロントエンド" value={info.olive_msystem.frontend} />
              <VersionItem label="olive-msystem バックエンド" value={info.olive_msystem.backend} />
              <VersionItem label="olive-p (解析エンジン)" value={info.olive_p ?? '—'} />
              <VersionItem label="実行環境" value={info.platform} small />
            </dl>
          </section>

          <section className="card mb-6">
            <h2 className="label mb-4">ランタイム・依存ライブラリ</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <VersionItem label="Python" value={info.python} />
              {Object.entries(info.dependencies).map(([name, ver]) => (
                <VersionItem key={name} label={name} value={ver || '—'} />
              ))}
            </dl>
          </section>

          <p className="text-center text-xs text-neutral-400">
            更新日時: {new Date().toLocaleString('ja-JP')}
          </p>
        </>
      )}
    </div>
  );
}

function VersionItem({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
      <dt className="text-sm text-neutral-500">{label}</dt>
      <dd className={`ml-4 font-medium tabular-nums text-neutral-800 ${small ? 'text-xs' : 'text-sm'}`}>
        {value}
      </dd>
    </div>
  );
}
