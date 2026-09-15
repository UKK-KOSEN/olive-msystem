'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, FarmMapData, FarmMapTree, FarmerRecord } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { healthColor, healthJa } from '@/components/charts';
import ErrorNotice from '@/components/ErrorNotice';

const HEALTH_ORDER = ['happy', 'good', 'caution', 'danger'] as const;

export default function FarmMapPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [farmers, setFarmers] = useState<FarmerRecord[]>([]);
  const [farmerId, setFarmerId] = useState<number | null>(null);
  const [data, setData] = useState<FarmMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(
    (fid: number | null) => {
      setLoading(true);
      setError(null);
      setSelected(null);
      api
        .farmMap(isAdmin ? fid ?? undefined : undefined)
        .then(setData)
        .catch((e: any) => setError(e?.message || '農園マップの取得に失敗しました'))
        .finally(() => setLoading(false));
    },
    [isAdmin]
  );

  useEffect(() => {
    if (!isAdmin) {
      load(null);
      return;
    }
    api
      .listFarmers()
      .then((list) => {
        setFarmers(list);
        setFarmerId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch(() => {});
  }, [isAdmin, load]);

  useEffect(() => {
    if (!isAdmin || farmerId == null) return;
    load(farmerId);
  }, [isAdmin, farmerId, load]);

  const summary = useMemo(() => {
    const out = { total: 0, decided: 0, unobserved: 0, health: { happy: 0, good: 0, caution: 0, danger: 0 } as Record<string, number>, avgScore: 0 };
    if (!data?.trees) return out;
    out.total = data.trees.length;
    let scoreSum = 0;
    for (const t of data.trees) {
      if (!t.state) {
        out.unobserved += 1;
        continue;
      }
      out.decided += 1;
      out.health[t.state.label] = (out.health[t.state.label] || 0) + 1;
      scoreSum += t.state.score;
    }
    out.avgScore = out.decided > 0 ? scoreSum / out.decided : 0;
    return out;
  }, [data]);

  const selectedTree = useMemo(
    () => data?.trees.find((t) => t.tree_id === selected) ?? null,
    [data, selected]
  );

  const mapW = data?.map.width ?? 1084;
  const mapH = data?.map.height ?? 400;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-800">農園マップ</h1>
          <p className="mt-1 text-sm text-neutral-500">
            樹木IDごとの最新の体調を模擬的な農園地図に表示します。記録済みの樹木が対象です。
          </p>
        </div>
      </div>

      {isAdmin && (
        <section className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-sm font-medium text-neutral-700">表示する農家</span>
          <select
            value={farmerId ?? ''}
            onChange={(e) => setFarmerId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-olive-500 focus:outline-none"
          >
            <option value="" disabled>
              表示する農家を選択
            </option>
            {farmers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.farm_name || f.display_name || f.username}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">
            各農家の農園を模擬的に表示します（樹木の配置は樹木IDから自動生成されます）。
          </p>
        </section>
      )}

      {/* legend */}
      <section className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-neutral-200 bg-white p-3 text-sm">
        <span className="font-medium text-neutral-700">凡例</span>
        {HEALTH_ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: healthColor(k) }} />
            <span className="text-neutral-600">{healthJa(k)}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border border-dashed border-neutral-400 bg-transparent" />
          <span className="text-neutral-600">未観測</span>
        </span>
        <span className="ml-auto text-xs text-neutral-400">ツリーをクリックすると詳細を表示します</span>
      </section>

      {/* summary strip */}
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="総樹木数" value={String(summary.total)} />
        <SummaryCard label="健康" value={String(summary.health.happy)} color={healthColor('happy')} />
        <SummaryCard label="良好" value={String(summary.health.good)} color={healthColor('good')} />
        <SummaryCard label="注意" value={String(summary.health.caution)} color={healthColor('caution')} />
        <SummaryCard label="要管理" value={String(summary.health.danger)} color={healthColor('danger')} />
        <SummaryCard label="平均スコア" value={summary.decided > 0 ? Math.round(summary.avgScore * 100) + '点' : '—'} color="#555" />
      </section>

      <ErrorNotice message={error} onRetry={() => load(farmerId)} />

      {loading ? (
        <div className="grid place-items-center rounded-xl border border-neutral-200 bg-white py-24 text-sm text-neutral-400">
          読み込み中…
        </div>
      ) : !data || data.trees.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-neutral-700">樹木ID付きの観測データがまだありません</p>
          <p className="mt-2 text-sm text-neutral-500">
            動画・画像解析時に「樹木ID」を入力すると、このマップに木として表示されます。
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
            <svg
              viewBox={`0 0 ${mapW} ${mapH}`}
              className="block h-auto w-full"
              style={{ background: 'linear-gradient(180deg, #f1f7ee 0%, #e6f0df 100%)' }}
            >
              <defs>
                <pattern id="farm-map-grid" width="118" height="130" patternUnits="userSpaceOnUse">
                  <rect width="118" height="130" fill="rgba(76,154,90,0.05)" />
                  <rect x="59" width="1" height="130" fill="rgba(76,154,90,0.08)" />
                </pattern>
              </defs>

              {/* field boundary */}
              <rect
                x={24}
                y={24}
                width={mapW - 48}
                height={mapH - 48}
                rx={18}
                fill="url(#farm-map-grid)"
                stroke="#9db893"
                strokeWidth={2}
              />

              {/* corner decoration */}
              <text x={40} y={mapH - 32} fontSize={12} fill="#7a9772" fontStyle="italic">
                {data.farmer?.farm_name || '模擬農園'} — 樹木配置は樹木IDから自動生成
              </text>

              {/* trees */}
              {data.trees.map((t) => (
                <g key={t.tree_id} role="button" aria-label={`樹木 ${t.tree_id}`}>
                  <circle
                    cx={t.x}
                    cy={t.y}
                    r={26}
                    fill={selected === t.tree_id ? 'rgba(76,154,90,0.15)' : 'transparent'}
                    stroke={selected === t.tree_id ? '#4c9a5a' : 'transparent'}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                  <g onClick={() => setSelected(selected === t.tree_id ? null : t.tree_id)} className="cursor-pointer">
                    <title>{`${t.tree_id} — ${t.state ? healthJa(t.state.label) : '未観測'}`}</title>
                    <circle
                      cx={t.x}
                      cy={t.y}
                      r={17}
                      fill={t.state ? healthColor(t.state.label) : '#ffffff'}
                      stroke={t.state ? healthColor(t.state.label) : '#b6b6b6'}
                      strokeWidth={3}
                      strokeDasharray={t.state ? undefined : '4 4'}
                    />
                    <circle cx={t.x} cy={t.y} r={6} fill="rgba(255,255,255,0.85)" />
                    {t.state?.label === 'danger' && (
                      <text x={t.x} y={t.y + 2.5} fontSize={11} fontWeight={700} fill="#c25a4a" textAnchor="middle">
                        !
                      </text>
                    )}
                    <text
                      x={t.x}
                      y={t.y + 34}
                      fontSize={11}
                      fontWeight={selected === t.tree_id ? 700 : 500}
                      fill={selected === t.tree_id ? '#3c6e43' : '#6d6d6d'}
                      textAnchor="middle"
                      paintOrder="stroke"
                      stroke="rgba(255,255,255,0.9)"
                      strokeWidth={3}
                    >
                      {t.tree_id}
                    </text>
                  </g>
                </g>
              ))}
            </svg>
          </div>

          {/* detail panel */}
          <TreeDetail tree={selectedTree} onClear={() => setSelected(null)} />
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color = '#374151' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function TreeDetail({ tree, onClear }: { tree: FarmMapTree | null; onClear: () => void }) {
  if (!tree) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-white/60 p-5 text-center text-sm text-neutral-400">
        マップ上の樹木をクリックすると、その木の詳細がここに表示されます。
      </div>
    );
  }
  const state = tree.state;
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-4 w-4 rounded-full"
            style={{ background: state ? healthColor(state.label) : '#cccccc' }}
          />
          <h2 className="text-lg font-bold text-neutral-800">樹木ID: {tree.tree_id}</h2>
          {state ? (
            <span
              className="rounded-full px-3 py-1 text-sm font-bold"
              style={{ background: healthColor(state.label) + '22', color: healthColor(state.label) }}
            >
              {healthJa(state.label)} · {Math.round(state.score * 100)}点
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm font-bold text-neutral-500">未観測</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-50"
        >
          選択を解除
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-neutral-500">観測回数</p>
          <p className="mt-1 font-medium text-neutral-700">{tree.observation_count} 回</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">最初の観測</p>
          <p className="mt-1 font-medium text-neutral-700">{tree.first_seen ? formatDate(tree.first_seen) : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">最終観測</p>
          <p className="mt-1 font-medium text-neutral-700">{tree.observed_at ? formatDate(tree.observed_at) : '—'}</p>
        </div>
      </div>
      {state?.message ? (
        <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-700">{state.message}</div>
      ) : undefined}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}