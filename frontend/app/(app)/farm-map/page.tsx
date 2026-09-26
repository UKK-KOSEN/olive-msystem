'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, FarmMapTree, FarmTreeRecord, FarmerRecord } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { healthColor, healthJa, STATE_ORDER } from '@/components/charts';
import { Snackbar } from '@/components/Snackbar';
import { fmtDateTimeShort } from '@/lib/format';
import ErrorNotice from '@/components/ErrorNotice';

const MAP_COLS = 8;
const CELL_W = 118;
const PAD_X = 70;
const PAD_Y = 80;
const ZOOM_LEVELS = [0.75, 1, 1.5, 2] as const;

type Modal = { mode: 'add'; prefill?: string } | { mode: 'edit'; tree: FarmTreeRecord } | null;

export default function FarmMapPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [farmers, setFarmers] = useState<FarmerRecord[]>([]);
  const [farmerId, setFarmerId] = useState<number | null>(null);
  const [data, setData] = useState<{ map: { width: number; height: number }; trees: FarmMapTree[]; registered_count: number; unregistered_count: number; farmer?: { id: number; farm_name?: string | null; display_name?: string | null } | null } | null>(null);
  const [registry, setRegistry] = useState<FarmTreeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [snackbar, setSnackbar] = useState<{ message: string; kind: 'ok' | 'err' } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const farmerParam = useMemo(
    () => (isAdmin ? (farmerId != null ? farmerId : undefined) : undefined),
    [isAdmin, farmerId]
  );

  const load = useCallback(
    (fid: number | null) => {
      const sc = isAdmin ? (fid ?? undefined) : undefined;
      setLoading(true);
      setSelected(null);
      Promise.all([api.farmMap(sc), api.listFarmTrees(sc)])
        .then(([m, r]) => {
          setData(m);
          setRegistry(r.trees);
        })
        .catch((e: any) => setSnackbar({ message: e?.message || '農園マップの取得に失敗しました', kind: 'err' }))
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
    const out = {
      total: data?.trees?.length ?? 0,
      registered: data?.registered_count ?? 0,
      unregistered: data?.unregistered_count ?? 0,
      health: { happy: 0, good: 0, caution: 0, danger: 0 } as Record<string, number>,
      unobserved: 0,
      avgScore: 0,
    };
    if (!data?.trees) return out;
    let decided = 0;
    let scoreSum = 0;
    for (const t of data.trees) {
      if (!t.state) {
        out.unobserved += 1;
        continue;
      }
      decided += 1;
      out.health[t.state.label] = (out.health[t.state.label] || 0) + 1;
      scoreSum += t.state.score;
    }
    out.avgScore = decided > 0 ? scoreSum / decided : 0;
    return out;
  }, [data]);

  const query = search.trim().toLowerCase();
  const scoredTrees = useMemo(() => {
    const arr = data?.trees ?? [];
    const byRow: Record<number, { sum: number; n: number }> = {};
    for (const t of arr) {
      if (!t.state) continue;
      byRow[t.row] = byRow[t.row] || { sum: 0, n: 0 };
      byRow[t.row].sum += t.state.score;
      byRow[t.row].n += 1;
    }
    return byRow;
  }, [data]);

  const selectedTree = useMemo(
    () => data?.trees.find((t) => t.tree_id === selected) ?? null,
    [data, selected]
  );
  const selectedReg = useMemo(
    () => registry.find((r) => r.tree_id === selected) ?? null,
    [registry, selected]
  );

  const mapW = data?.map.width ?? 1084;
  const maxRow = Math.max(...(data?.trees.map((t) => t.row) ?? [1]));
  const mapH = data?.map.height ?? PAD_Y + maxRow * 130 + 30;

  const handleImport = async () => {
    setBusy(true);
    try {
      const r = await api.importFarmTrees(farmerParam);
      setSnackbar({ message: `観測済みの木から ${r.count} 本を自動登録しました。`, kind: 'ok' });
      load(farmerId);
    } catch (e: any) {
      setSnackbar({ message: e?.message || '自動登録に失敗しました', kind: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (tree_id: string) => {
    if (!window.confirm(`樹木「${tree_id}」を台帳から削除しますか？（観測データは残ります）`)) return;
    setBusy(true);
    try {
      await api.deleteFarmTree(tree_id, farmerParam);
      setSnackbar({ message: `樹木「${tree_id}」を削除しました。`, kind: 'ok' });
      setSelected(null);
      load(farmerId);
    } catch (e: any) {
      setSnackbar({ message: e?.message || '削除に失敗しました', kind: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const applyZoom = (z: number) => {
    setZoom(z);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ left: 0, top: 0 });
    });
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-800">農園マップ</h1>
          <p className="mt-1 text-sm text-neutral-500">
            樹木ごとの最新の体調を農園の区画図で確認できます。畝（行）・列を指定して樹木を登録できます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleImport}
            disabled={busy || loading}
            className="rounded-lg border border-olive-600 px-3 py-2 text-sm font-medium text-olive-700 transition-colors hover:bg-olive-50 disabled:opacity-50"
          >
            観測済みの木を自動登録
          </button>
          <button
            type="button"
            onClick={() => setModal({ mode: 'add' })}
            disabled={busy}
            className="rounded-lg bg-olive-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-olive-800 disabled:opacity-50"
          >
            + 樹木を登録
          </button>
        </div>
      </div>

      {isAdmin && (
        <section className="mt-6 mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
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
            各農家ごとに樹木台帳と農園の区画が独立しています。
          </p>
        </section>
      )}

      {/* legend + filter + search */}
      <section className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-neutral-200 bg-white p-3 text-sm">
        <span className="font-medium text-neutral-700">凡例</span>
        {STATE_ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: healthColor(k) }} />
            <span className="text-neutral-600">{healthJa(k)}</span>
            <span className="rounded-full bg-neutral-100 px-1.5 text-[11px] tabular-nums text-neutral-500">
              {summary.health[k] ?? 0}
            </span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border border-dashed border-neutral-400 bg-transparent" />
          <span className="text-neutral-600">未登録</span>
          <span className="rounded-full bg-neutral-100 px-1.5 text-[11px] tabular-nums text-neutral-500">{summary.unregistered}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border border-neutral-400 bg-neutral-50" />
          <span className="text-neutral-600">未観測</span>
          <span className="rounded-full bg-neutral-100 px-1.5 text-[11px] tabular-nums text-neutral-500">{summary.unobserved}</span>
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="樹木ID・名前で検索"
              className="w-44 rounded-lg border border-neutral-300 bg-white py-1.5 pl-8 pr-3 text-sm focus:border-olive-500 focus:outline-none"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-neutral-700">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={(e) => setOnlyIssues(e.target.checked)}
              className="h-4 w-4 accent-olive-700"
            />
            注意・要管理のみを強調
          </label>
        </div>
      </section>

      {/* summary strip + distribution bar */}
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <SummaryCard label="総樹木数" value={String(summary.total)} />
        <SummaryCard label="登録済み" value={String(summary.registered)} color="#374151" />
        <SummaryCard label="未登録" value={String(summary.unregistered)} color="#c99a2e" />
        <SummaryCard label="注意・要管理" value={String(summary.health.caution + summary.health.danger)} color={healthColor('danger')} />
        <SummaryCard label="未観測" value={String(summary.unobserved)} color="#8a8a8a" />
        <SummaryCard label="平均スコア" value={(summary.total - summary.unobserved) > 0 ? Math.round(summary.avgScore * 100) + '点' : '—'} color="#555" />
        <SummaryCard label="最終観測" value={latestObserved(data?.trees)} color="#555" />
      </section>

      {snackbar && (
        <Snackbar message={snackbar.message} kind={snackbar.kind} onClose={() => setSnackbar(null)} />
      )}

      {(() => {
        const hb = healthBreakdown(data?.trees);
        return hb ? <HealthBreakdown counts={hb} /> : null;
      })()}

      {loading ? (
        <div className="grid place-items-center rounded-xl border border-neutral-200 bg-white py-24 text-sm text-neutral-400" role="status" aria-live="polite" aria-busy="true">
          読み込み中…
        </div>
      ) : !data || data.trees.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center" role="status" aria-live="polite">
          <p className="text-sm font-medium text-neutral-700">この農家にはまだ樹木がありません</p>
          <p className="mt-2 text-sm text-neutral-500">
            「観測済みの木を自動登録」で実績から登録するか、動画・画像解析時に「樹木ID」を入力するとその木がマップに現れます。
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            {/* map toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50/60 px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span className="font-medium text-neutral-700">
                  {data.farmer?.farm_name || data.farmer?.display_name || 'この農家'}の区画
                </span>
                <span>・畝 {maxRow} ・ 列 {MAP_COLS}</span>
                {query && (
                  <span className="rounded-full bg-olive-100 px-2 py-0.5 font-medium text-olive-700">
                    検索: 「{search.trim()}」 {matchedCount(data.trees, query)} 件
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs text-neutral-400">表示</span>
                {ZOOM_LEVELS.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => applyZoom(z)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      zoom === z ? 'bg-olive-700 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    {Math.round(z * 100)}%
                  </button>
                ))}
              </div>
            </div>

            <div ref={scrollRef} className="max-h-[560px] overflow-auto bg-[#eef4e9]">
              <div style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
                <svg
                  viewBox={`0 0 ${mapW} ${mapH}`}
                  className="block h-auto w-full"
                  style={{ background: 'linear-gradient(180deg, #f3f8ef 0%, #e7f1e0 100%)' }}
                >
                  {/* field outline */}
                  <rect
                    x={PAD_X - 6}
                    y={PAD_Y - 10}
                    width={MAP_COLS * CELL_W + 12}
                    height={(maxRow * 130) + 20}
                    rx={14}
                    fill="rgba(255,255,255,0.35)"
                    stroke="rgba(122,151,114,0.5)"
                    strokeWidth={1.5}
                  />

                  {/* row bands */}
                  {Array.from({ length: maxRow }, (_, r) => (
                    <rect
                      key={`band-${r}`}
                      x={PAD_X}
                      y={PAD_Y + r * 130}
                      width={MAP_COLS * CELL_W}
                      height={130}
                      fill={r % 2 === 1 ? 'rgba(255,255,255,0.35)' : 'transparent'}
                    />
                  ))}

                  {/* column separators */}
                  {Array.from({ length: MAP_COLS + 1 }, (_, i) => (
                    <line
                      key={`col-s-${i}`}
                      x1={PAD_X + i * CELL_W}
                      y1={PAD_Y + 34}
                      x2={PAD_X + i * CELL_W}
                      y2={PAD_Y + maxRow * 130}
                      stroke="rgba(122,151,114,0.22)"
                      strokeWidth={1}
                    />
                  ))}

                  {/* row separators */}
                  {Array.from({ length: maxRow + 1 }, (_, r) => (
                    <line
                      key={`row-s-${r}`}
                      x1={PAD_X}
                      y1={PAD_Y + r * 130}
                      x2={PAD_X + MAP_COLS * CELL_W}
                      y2={PAD_Y + r * 130}
                      stroke="rgba(122,151,114,0.22)"
                      strokeWidth={1}
                    />
                  ))}

                  {/* column header band */}
                  <rect
                    x={PAD_X}
                    y={PAD_Y}
                    width={MAP_COLS * CELL_W}
                    height={34}
                    fill="rgba(122,151,114,0.08)"
                  />
                  {Array.from({ length: MAP_COLS }, (_, i) => (
                    <text
                      key={`col-${i}`}
                      x={PAD_X + i * CELL_W + CELL_W / 2}
                      y={PAD_Y + 21}
                      fontSize={12}
                      fontWeight={700}
                      fill="#7a9772"
                      textAnchor="middle"
                    >
                      列 {i + 1}
                    </text>
                  ))}

                  {/* row labels (畝) */}
                  {Array.from({ length: maxRow }, (_, i) => {
                    const r = i + 1;
                    const s = scoredTrees[r];
                    return (
                      <g key={`row-${i}`}>
                        <text
                          x={PAD_X - 21}
                          y={PAD_Y + i * 130 + 62}
                          fontSize={12}
                          fontWeight={700}
                          fill="#7a9772"
                          textAnchor="middle"
                        >
                          畝 {r}
                        </text>
                        {s && (
                          <text
                            x={PAD_X - 21}
                            y={PAD_Y + i * 130 + 78}
                            fontSize={9}
                            fontWeight={600}
                            fill="#9db395"
                            textAnchor="middle"
                          >
                            {Math.round((s.sum / s.n) * 100)}点
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* trees */}
                  {data.trees
                    .filter((t) => !onlyIssues || t.state == null || t.state.label === 'caution' || t.state.label === 'danger')
                    .map((t) => {
                      const matches = !query || includesQuery(t, query);
                      return (
                        <TreeNode
                          key={t.tree_id}
                          t={t}
                          dimmed={
                            (onlyIssues && t.state != null && t.state.label !== 'caution' && t.state.label !== 'danger') ||
                            (!!query && !matches)
                          }
                          hidden={!!query && !matches}
                          selected={selected === t.tree_id}
                          onSelect={(id) => setSelected(selected === id ? null : id)}
                        />
                      );
                    })}
                </svg>
              </div>
            </div>
          </div>

          <TreeDetail
            tree={selectedTree}
            reg={selectedReg}
            onClear={() => setSelected(null)}
            onEdit={selectedReg ? () => setModal({ mode: 'edit', tree: selectedReg }) : () => setModal({ mode: 'add', prefill: selected ?? undefined })}
          />
        </>
      )}

      {/* registry table */}
      <section className="mt-6">
        <h2 className="mb-2 text-base font-bold text-neutral-800">樹木台帳（登録済み）</h2>
        {registry.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white/60 p-6 text-center text-sm text-neutral-400">
            登録済みの樹木はありません。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                  <th className="px-3 py-2 font-medium">樹木ID</th>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 font-medium">品種</th>
                  <th className="px-3 py-2 font-medium">配置</th>
                  <th className="px-3 py-2 font-medium">最新状態</th>
                  <th className="px-3 py-2 text-right font-medium">観測数</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {registry.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-neutral-800">{r.tree_id}</td>
                    <td className="px-3 py-2 text-neutral-600">{r.name || '—'}</td>
                    <td className="px-3 py-2 text-neutral-600">{r.variety || '—'}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      畝 {r.row_num} ・ 列 {r.col_num}
                    </td>
                    <td className="px-3 py-2">
                      {r.state ? (
                        <span
                          className="rounded-full px-2.5 py-0.5 text-xs font-bold"
                          style={{ background: healthColor(r.state.label) + '22', color: healthColor(r.state.label) }}
                        >
                          {healthJa(r.state.label)} · {Math.round(r.state.score * 100)}点
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">未観測</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-neutral-600">{r.observation_count ?? 0}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setModal({ mode: 'edit', tree: r })}
                        className="mr-2 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r.tree_id)}
                        disabled={busy}
                        className="rounded-md border border-health-danger/30 px-2 py-1 text-xs text-health-danger transition-colors hover:bg-health-danger/10 disabled:opacity-50"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <TreeFormModal
          isAdmin={isAdmin}
          farmerParam={farmerParam}
          modal={modal}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            load(farmerId);
          }}
        />
      )}
    </div>
  );
}

function includesQuery(t: FarmMapTree, q: string): boolean {
  return t.tree_id.toLowerCase().includes(q) || (t.name ?? '').toLowerCase().includes(q);
}

function matchedCount(trees: FarmMapTree[], q: string): number {
  return trees.filter((t) => includesQuery(t, q)).length;
}

function healthBreakdown(trees?: FarmMapTree[] | null): Record<string, number> | null {
  if (!trees || trees.length === 0) return null;
  const counts: Record<string, number> = { happy: 0, good: 0, caution: 0, danger: 0, unobserved: 0 };
  for (const t of trees) {
    if (!t.state) {
      counts.unobserved += 1;
    } else {
      counts[t.state.label] = (counts[t.state.label] || 0) + 1;
    }
  }
  return counts;
}

function healthBreakdownTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** Compact stacked distribution bar for the current farm. */
function HealthBreakdown({ counts }: { counts: Record<string, number> }) {
  const total = healthBreakdownTotal(counts);
  const segs: { key: string; label: string; color: string; count: number }[] = [
    { key: 'happy', label: '健康', color: healthColor('happy'), count: counts.happy ?? 0 },
    { key: 'good', label: '良好', color: healthColor('good'), count: counts.good ?? 0 },
    { key: 'caution', label: '注意', color: healthColor('caution'), count: counts.caution ?? 0 },
    { key: 'danger', label: '要管理', color: healthColor('danger'), count: counts.danger ?? 0 },
    { key: 'unobserved', label: '未観測', color: '#d6d6d6', count: counts.unobserved ?? 0 },
  ];
  return (
    <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
        {segs.map((s) =>
          s.count > 0 ? (
            <div
              key={s.key}
              className="h-full transition-all"
              style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
            />
          ) : null
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segs.filter((s) => s.count > 0).map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="tabular-nums font-medium text-neutral-700">{s.count}</span>
            <span className="text-neutral-400">({Math.round((s.count / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  t,
  dimmed,
  hidden,
  selected,
  onSelect,
}: {
  t: FarmMapTree;
  dimmed: boolean;
  hidden?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const color = t.state ? healthColor(t.state.label) : '#cccccc';
  const label = t.name || t.tree_id;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(t.tree_id);
    }
  };
  const tooltipParts = [`${t.tree_id} — ${t.state ? `${healthJa(t.state.label)} ${Math.round(t.state.score * 100)}点` : '未観測'}`];
  tooltipParts.push(t.registered ? `畝 ${t.row}・列 ${t.col}` : '未登録（仮配置）');
  if (t.observation_count > 0) tooltipParts.push(`観測 ${t.observation_count}回`);
  if (t.last_seen) tooltipParts.push(`最終 ${t.last_seen.slice(0, 10)}`);
  if (t.state?.message) tooltipParts.push(t.state.message);

  return hidden ? null : (
    <g role="button" tabIndex={0} aria-label={`樹木 ${t.tree_id}`} onKeyDown={handleKeyDown}>
      <circle
        cx={t.x}
        cy={t.y}
        r={26}
        fill={selected ? 'rgba(76,154,90,0.15)' : 'transparent'}
        stroke={selected ? '#4c9a5a' : 'transparent'}
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      <g onClick={() => onSelect(t.tree_id)} className="cursor-pointer" opacity={dimmed ? 0.25 : 1} style={{ transition: 'opacity 0.15s' }}>
        <title>{tooltipParts.join('\n')}</title>
        {/* crown */}
        <circle
          cx={t.x}
          cy={t.y}
          r={17}
          fill={t.state ? color + '26' : '#f6f6f6'}
          stroke={t.registered ? color : '#b6b6b6'}
          strokeWidth={3}
          strokeDasharray={t.registered ? undefined : '4 4'}
        />
        {/* inner core */}
        <circle cx={t.x} cy={t.y} r={6} fill={t.state ? color : '#ffffff'} />
        {t.state?.label === 'danger' && (
          <text x={t.x} y={t.y + 2.5} fontSize={11} fontWeight={700} fill="#c25a4a" textAnchor="middle">
            !
          </text>
        )}
        {/* observation count badge */}
        {t.observation_count > 0 && (
          <g>
            <circle cx={t.x + 16} cy={t.y - 16} r={8} fill="#ffffff" stroke={color} strokeWidth={1.5} />
            <text x={t.x + 16} y={t.y - 12.5} fontSize={8.5} fontWeight={800} fill="#4a6a46" textAnchor="middle">
              {Math.min(t.observation_count, 99)}
            </text>
          </g>
        )}
        {!t.registered && (
          <text x={t.x} y={t.y - 26} fontSize={9.5} fontWeight={600} fill="#c99a2e" textAnchor="middle">
            未登録
          </text>
        )}
        {/* label + score */}
        <text
          x={t.x}
          y={t.y + 34}
          fontSize={11}
          fontWeight={selected ? 700 : 500}
          fill={selected ? '#3c6e43' : '#6d6d6d'}
          textAnchor="middle"
          paintOrder="stroke"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={3}
        >
          {label}
        </text>
        {t.state && (
          <text
            x={t.x}
            y={t.y + 34 + (selected ? 13 : 0)}
            fontSize={selected ? 10 : 0}
            fontWeight={600}
            fill={color}
            textAnchor="middle"
            paintOrder="stroke"
            stroke="rgba(255,255,255,0.95)"
            strokeWidth={3}
          >
            {Math.round(t.state.score * 100)}点
          </text>
        )}
      </g>
    </g>
  );
}

function TreeDetail({
  tree,
  reg,
  onClear,
  onEdit,
}: {
  tree: FarmMapTree | null;
  reg: FarmTreeRecord | null;
  onClear: () => void;
  onEdit: () => void;
}) {
  if (!tree) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-white/60 p-5 text-center text-sm text-neutral-400" role="status" aria-live="polite">
        マップ上の樹木をクリックまたはEnterキーで選択すると、その木の詳細がここに表示されます。
      </div>
    );
  }
  const state = tree.state;
  const name = tree.name || reg?.name;
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-sm" role="region" aria-label={`樹木 ${tree.tree_id} の詳細`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          <span className="inline-block h-4 w-4 rounded-full shrink-0" style={{ background: state ? healthColor(state.label) : '#cccccc' }} aria-hidden="true" />
          <h2 className="text-lg font-bold text-neutral-800 truncate">{tree.tree_id}</h2>
          {name && name !== tree.tree_id && <span className="text-sm text-neutral-500 truncate">{name}</span>}
          {state ? (
            <span
              className="rounded-full px-3 py-1 text-sm font-bold shrink-0"
              style={{ background: healthColor(state.label) + '22', color: healthColor(state.label) }}
            >
              {healthJa(state.label)} · {Math.round(state.score * 100)}点
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm font-bold text-neutral-500 shrink-0">未観測</span>
          )}
          {tree.registered ? (
            <span className="rounded-full bg-olive-100 px-3 py-1 text-xs font-bold text-olive-700 shrink-0">登録済み</span>
          ) : (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700 shrink-0">未登録</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-50 shrink-0"
        >
          選択を解除
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div>
          <p className="text-xs text-neutral-500">配置（畝・列）</p>
          <p className="mt-1 font-medium text-neutral-700">
            {tree.registered ? `畝 ${tree.row} ・ 列 ${tree.col}` : '未登録（仮配置）'}
          </p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">品種</p>
          <p className="mt-1 font-medium text-neutral-700">{reg?.variety || tree.variety || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">観測回数</p>
          <p className="mt-1 font-medium text-neutral-700">{tree.observation_count} 回</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">最終観測</p>
          <p className="mt-1 font-medium text-neutral-700">{tree.last_seen ? fmtDateTimeShort(tree.last_seen) : '—'}</p>
        </div>
      </div>
      {state?.message ? (
        <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-700">{state.message}</div>
      ) : undefined}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/tracking?tree=${encodeURIComponent(tree.tree_id)}`}
          className="rounded-lg border border-olive-600 px-3 py-1.5 text-sm font-medium text-olive-700 transition-colors hover:bg-olive-50"
        >
          観測記録を見る
        </Link>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-50"
        >
          {tree.registered ? '登録情報を編集' : 'この木を登録'}
        </button>
      </div>
    </div>
  );
}

function TreeFormModal({
  isAdmin,
  farmerParam,
  modal,
  onClose,
  onDone,
}: {
  isAdmin: boolean;
  farmerParam: number | undefined;
  modal: Exclude<Modal, null>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [treeId, setTreeId] = useState(modal.mode === 'edit' ? modal.tree.tree_id : modal.prefill ?? '');
  const [name, setName] = useState(modal.mode === 'edit' ? modal.tree.name ?? '' : '');
  const [variety, setVariety] = useState(modal.mode === 'edit' ? modal.tree.variety ?? '' : '');
  const [row, setRow] = useState(String(modal.mode === 'edit' ? modal.tree.row_num : 1));
  const [col, setCol] = useState(String(modal.mode === 'edit' ? modal.tree.col_num : 1));
  const [note, setNote] = useState(modal.mode === 'edit' ? modal.tree.note ?? '' : '');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    const tid = treeId.trim();
    const r = Math.max(1, Number(row) || 1);
    const c = Math.max(1, Number(col) || 1);
    if (!tid) {
      setFormError('樹木IDを入力してください');
      return;
    }
    const payload = { name: name.trim() || undefined, variety: variety.trim() || undefined, row_num: r, col_num: c, note: note.trim() || undefined };
    setSaving(true);
    try {
      if (modal.mode === 'edit') {
        await api.updateFarmTree(modal.tree.tree_id, payload, farmerParam);
      } else {
        await api.createFarmTree({ tree_id: tid, ...payload }, farmerParam);
      }
      onDone();
    } catch (e: any) {
      setFormError(e?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-neutral-800">{modal.mode === 'edit' ? '樹木の編集' : '樹木を登録'}</h2>
        {isAdmin && (
          <p className="mt-1 text-xs text-neutral-400">対象農家: 選択中の農家（farmer_id={farmerParam}）</p>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="text-xs text-neutral-500">樹木ID（必須）</span>
            <input
              value={treeId}
              onChange={(e) => setTreeId(e.target.value)}
              disabled={modal.mode === 'edit'}
              placeholder="例: A-01"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-olive-500 focus:outline-none disabled:bg-neutral-100"
            />
          </label>
          <label>
            <span className="text-xs text-neutral-500">名称（任意）</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 奥のオリーブ"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-olive-500 focus:outline-none"
            />
          </label>
          <label>
            <span className="text-xs text-neutral-500">品種（任意）</span>
            <input
              value={variety}
              onChange={(e) => setVariety(e.target.value)}
              placeholder="例: ルッカ"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-olive-500 focus:outline-none"
            />
          </label>
          <label>
            <span className="text-xs text-neutral-500">畝（行番号）</span>
            <input
              type="number"
              min={1}
              value={row}
              onChange={(e) => setRow(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-olive-500 focus:outline-none"
            />
          </label>
          <label>
            <span className="text-xs text-neutral-500">列番号</span>
            <input
              type="number"
              min={1}
              value={col}
              onChange={(e) => setCol(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-olive-500 focus:outline-none"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs text-neutral-500">メモ（任意）</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-olive-500 focus:outline-none"
            />
          </label>
        </div>
        {formError && (
          <div role="alert" className="mt-3 rounded-lg bg-health-danger/10 px-3 py-2 text-sm text-health-danger">
            {formError}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-olive-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-olive-800 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
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

function latestObserved(trees?: FarmMapTree[] | null): string {
  if (!trees || trees.length === 0) return '—';
  const times = trees.map((t) => t.last_seen).filter((v): v is string => !!v).sort().reverse();
  if (times.length === 0) return '—';
  const d = new Date(times[0]);
  return isNaN(d.getTime()) ? times[0] : d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}