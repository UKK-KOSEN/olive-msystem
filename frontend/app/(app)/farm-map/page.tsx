'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, FarmMapTree, FarmTreeRecord, FarmerRecord } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { healthColor, healthJa } from '@/components/charts';
import ErrorNotice from '@/components/ErrorNotice';

const HEALTH_ORDER = ['happy', 'good', 'caution', 'danger'] as const;
const MAP_COLS = 8;

type Modal = { mode: 'add'; prefill?: string } | { mode: 'edit'; tree: FarmTreeRecord } | null;

export default function FarmMapPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [farmers, setFarmers] = useState<FarmerRecord[]>([]);
  const [farmerId, setFarmerId] = useState<number | null>(null);
  const [data, setData] = useState<{ map: { width: number; height: number }; trees: FarmMapTree[]; registered_count: number; unregistered_count: number; farmer?: { id: number; farm_name?: string | null; display_name?: string | null } | null } | null>(null);
  const [registry, setRegistry] = useState<FarmTreeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);

  const farmerParam = useMemo(
    () => (isAdmin ? (farmerId != null ? farmerId : undefined) : undefined),
    [isAdmin, farmerId]
  );

  const load = useCallback(
    (fid: number | null) => {
      const sc = isAdmin ? (fid ?? undefined) : undefined;
      setLoading(true);
      setError(null);
      setSelected(null);
      Promise.all([api.farmMap(sc), api.listFarmTrees(sc)])
        .then(([m, r]) => {
          setData(m);
          setRegistry(r.trees);
        })
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
    const out = {
      total: data?.trees.length ?? 0,
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

  const selectedTree = useMemo(
    () => data?.trees.find((t) => t.tree_id === selected) ?? null,
    [data, selected]
  );
  const selectedReg = useMemo(
    () => registry.find((r) => r.tree_id === selected) ?? null,
    [registry, selected]
  );

  const mapW = data?.map.width ?? 1084;
  const mapH = data?.map.height ?? 400;
  const maxRow = Math.max(...(data?.trees.map((t) => t.row) ?? [1]));

  const handleImport = async () => {
    setBusy(true);
    setInfo(null);
    setError(null);
    try {
      const r = await api.importFarmTrees(farmerParam);
      setInfo(`観測済みの木から ${r.count} 本を自動登録しました。`);
      load(farmerId);
    } catch (e: any) {
      setError(e?.message || '自動登録に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (tree_id: string) => {
    if (!window.confirm(`樹木「${tree_id}」を台帳から削除しますか？（観測データは残ります）`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteFarmTree(tree_id, farmerParam);
      setInfo(`樹木「${tree_id}」を削除しました。`);
      setSelected(null);
      load(farmerId);
    } catch (e: any) {
      setError(e?.message || '削除に失敗しました');
    } finally {
      setBusy(false);
    }
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

      {/* legend + filter */}
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
          <span className="text-neutral-600">未登録の木</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border border-neutral-400 bg-neutral-50" />
          <span className="text-neutral-600">未観測</span>
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-neutral-700">
          <input
            type="checkbox"
            checked={onlyIssues}
            onChange={(e) => setOnlyIssues(e.target.checked)}
            className="h-4 w-4 accent-olive-700"
          />
          注意・要管理のみを強調
        </label>
      </section>

      {/* summary strip */}
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <SummaryCard label="総樹木数" value={String(summary.total)} />
        <SummaryCard label="登録済み" value={String(summary.registered)} color="#374151" />
        <SummaryCard label="未登録" value={String(summary.unregistered)} color="#c99a2e" />
        <SummaryCard label="注意・要管理" value={String(summary.health.caution + summary.health.danger)} color={healthColor('danger')} />
        <SummaryCard label="未観測" value={String(summary.unobserved)} color="#8a8a8a" />
        <SummaryCard label="平均スコア" value={(summary.total - summary.unobserved) > 0 ? Math.round(summary.avgScore * 100) + '点' : '—'} color="#555" />
        <SummaryCard label="最終観測" value={latestObserved(data?.trees)} color="#555" />
      </section>

      {info && (
        <div className="mt-3 rounded-lg bg-olive-50 px-3 py-2.5 text-sm text-olive-800">{info}</div>
      )}
      <ErrorNotice message={error} onRetry={() => load(farmerId)} />

      {loading ? (
        <div className="grid place-items-center rounded-xl border border-neutral-200 bg-white py-24 text-sm text-neutral-400">
          読み込み中…
        </div>
      ) : !data || data.trees.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-neutral-700">この農家にはまだ樹木がありません</p>
          <p className="mt-2 text-sm text-neutral-500">
            「観測済みの木を自動登録」で実績から登録するか、動画・画像解析時に「樹木ID」を入力するとその木がマップに現れます。
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
              {/* column labels (列) */}
              {Array.from({ length: MAP_COLS }, (_, i) => (
                <text
                  key={`col-${i}`}
                  x={70 + i * 118 + 59}
                  y={46}
                  fontSize={12}
                  fontWeight={600}
                  fill="#7a9772"
                  textAnchor="middle"
                >
                  列 {i + 1}
                </text>
              ))}
              {/* row labels (畝) */}
              {Array.from({ length: maxRow }, (_, i) => (
                <text
                  key={`row-${i}`}
                  x={42}
                  y={70 + i * 130 + 65}
                  fontSize={12}
                  fontWeight={600}
                  fill="#7a9772"
                  textAnchor="middle"
                >
                  畝 {i + 1}
                </text>
              ))}

              {/* trees */}
              {data.trees
                .filter((t) => !onlyIssues || t.state == null || t.state.label === 'caution' || t.state.label === 'danger')
                .map((t) => (
                  <TreeNode
                    key={t.tree_id}
                    t={t}
                    dimmed={onlyIssues && t.state != null && t.state.label !== 'caution' && t.state.label !== 'danger'}
                    selected={selected === t.tree_id}
                    onSelect={(id) => setSelected(selected === id ? null : id)}
                  />
                ))}
            </svg>
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

function TreeNode({
  t,
  dimmed,
  selected,
  onSelect,
}: {
  t: FarmMapTree;
  dimmed: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const color = t.state ? healthColor(t.state.label) : '#cccccc';
  const label = t.name || t.tree_id;
  return (
    <g role="button" aria-label={`樹木 ${t.tree_id}`}>
      <circle
        cx={t.x}
        cy={t.y}
        r={26}
        fill={selected ? 'rgba(76,154,90,0.15)' : 'transparent'}
        stroke={selected ? '#4c9a5a' : 'transparent'}
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      <g
        onClick={() => onSelect(t.tree_id)}
        className="cursor-pointer"
        opacity={dimmed ? 0.2 : 1}
        style={{ transition: 'opacity 0.15s' }}
      >
        <title>{`${t.tree_id} — ${t.state ? healthJa(t.state.label) : '未観測'}${t.registered ? '' : '（未登録）'}`}</title>
        <circle
          cx={t.x}
          cy={t.y}
          r={17}
          fill={t.state ? color : '#f6f6f6'}
          stroke={t.registered ? color : '#b6b6b6'}
          strokeWidth={3}
          strokeDasharray={t.registered ? undefined : '4 4'}
        />
        <circle cx={t.x} cy={t.y} r={6} fill="rgba(255,255,255,0.85)" />
        {t.state?.label === 'danger' && (
          <text x={t.x} y={t.y + 2.5} fontSize={11} fontWeight={700} fill="#c25a4a" textAnchor="middle">
            !
          </text>
        )}
        {!t.registered && (
          <text x={t.x} y={t.y - 26} fontSize={9.5} fontWeight={600} fill="#c99a2e" textAnchor="middle">
            未登録
          </text>
        )}
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
      <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-white/60 p-5 text-center text-sm text-neutral-400">
        マップ上の樹木をクリックすると、その木の詳細がここに表示されます。
      </div>
    );
  }
  const state = tree.state;
  const name = tree.name || reg?.name;
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-block h-4 w-4 rounded-full" style={{ background: state ? healthColor(state.label) : '#cccccc' }} />
          <h2 className="text-lg font-bold text-neutral-800">{tree.tree_id}</h2>
          {name && name !== tree.tree_id && <span className="text-sm text-neutral-500">{name}</span>}
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
          {tree.registered ? (
            <span className="rounded-full bg-olive-100 px-3 py-1 text-xs font-bold text-olive-700">登録済み</span>
          ) : (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">未登録</span>
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
      <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
          <p className="mt-1 font-medium text-neutral-700">{tree.last_seen ? formatDate(tree.last_seen) : '—'}</p>
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}