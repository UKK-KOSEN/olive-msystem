'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, FarmerRecord, Observation, TreeRecord } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { healthJa, healthColor, STATE_ORDER, stateOf, obsScore, TrendChart, StatePill } from '@/components/charts';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import ErrorNotice from '@/components/ErrorNotice';
import { ObservationDetail } from '@/components/ObservationDetail';
import { IconUser, IconDownload, IconTrash, IconChevronRight } from '@/components/icons';
import { fmtDateTime } from '@/lib/format';

type StateFilter = 'all' | (typeof STATE_ORDER)[number];
type SourceFilter = 'all' | 'video' | 'image';

function ownerLabel(o: { display_name?: string | null; farm_name?: string | null; username?: string }): string {
  if (o.farm_name) return o.farm_name;
  if (o.display_name) return o.display_name;
  return o.username || '';
}

export default function TrackingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [obs, setObs] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  // filters
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [farmers, setFarmers] = useState<FarmerRecord[]>([]);
  const [farmerId, setFarmerId] = useState<number | null>(null);
  const [trees, setTrees] = useState<TreeRecord[]>([]);
  const [treeId, setTreeId] = useState<string | null>(null);

  // Support deep-links from the farm map: /tracking?tree=A-01&farmer_id=3
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get('tree');
    if (t) setTreeId(t);
    // Admins: keep the farmer scope chosen on the farm map so we never drift
    // to a different farmer's rows. Farmers are always confined to themselves.
    if (user?.role === 'admin') {
      const f = p.get('farmer_id');
      const n = f ? Number(f) : NaN;
      if (!Number.isNaN(n)) setFarmerId(n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<'delete' | 'export' | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmSingle, setConfirmSingle] = useState<Observation | null>(null);

  const load = useCallback(async (fid: number | null, fd: string, td: string, src: SourceFilter, tid?: string | null) => {
    setLoading(true);
    try {
      const data = await api.observations(undefined, fid ?? undefined, {
        from_date: fd || undefined,
        to_date: td || undefined,
        source_type: src === 'all' ? undefined : src,
        tree_id: tid || undefined,
      });
      setObs(data);
      setSelected((sel) => new Set([...sel].filter((id) => data.some((o) => o.id === id))));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'バックエンドに接続できません。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) api.listFarmers().then(setFarmers).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    api.listTrees().then(setTrees).catch(() => setTrees([]));
  }, []);

  // Admins see every farmer merged into one trend otherwise; default to the
  // farmer with the most recent observation so the chart plots like a farmer's.
  useEffect(() => {
    if (!isAdmin || farmerId != null) return;
    const groups = new Map<number, { latest: number; count: number }>();
    for (const o of obs) {
      if (o.user_id == null) continue;
      const t = new Date(o.observed_at).getTime() || 0;
      const g = groups.get(o.user_id) ?? { latest: 0, count: 0 };
      g.count += 1;
      if (t > g.latest) g.latest = t;
      groups.set(o.user_id, g);
    }
    const ranked = [...groups.entries()].sort(
      (a, b) => b[1].latest - a[1].latest || b[1].count - a[1].count
    );
    if (ranked.length > 0) setFarmerId(ranked[0][0]);
  }, [isAdmin, farmerId, obs]);

  useEffect(() => {
    load(farmerId, fromDate, toDate, sourceFilter, treeId);
  }, [load, farmerId, fromDate, toDate, sourceFilter, treeId]);

  const sorted = useMemo(() => [...obs].sort((a, b) => b.id - a.id), [obs]);

  // client-side state + search filter (search also triggers a narrow server query if empty dates)
  const filtered = useMemo(() => {
    let list = sorted;
    if (stateFilter !== 'all') list = list.filter((o) => stateOf(o) === stateFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((o) =>
        (o.filename || '').toLowerCase().includes(q) ||
        String(o.id).includes(q) ||
        (o.owner?.farm_name || '').toLowerCase().includes(q) ||
        (o.owner?.display_name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [sorted, stateFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { happy: 0, good: 0, caution: 0, danger: 0 };
    for (const o of obs) { const s = stateOf(o); if (s in c) c[s]++; }
    return c;
  }, [obs]);

  const sourceCounts = useMemo(() => {
    let video = 0, image = 0;
    for (const o of obs) {
      const src = o.source_type || (o.image_id ? 'image' : 'video');
      if (src === 'image') image++; else video++;
    }
    return { video, image };
  }, [obs]);

  const editRemove = async (o: Observation) => {
    setRemoving(o.id);
    try {
      await api.deleteOwnObservation(o.id);
      setConfirmSingle(null);
      await load(farmerId, fromDate, toDate, sourceFilter);
    } catch (e: any) {
      setError(e.message || '削除に失敗しました');
    } finally {
      setRemoving(null);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((sel) => {
      const n = new Set(sel);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    setSelected((sel) => {
      if (sel.size === filtered.length) return new Set();
      return new Set(filtered.map((o) => o.id));
    });
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkAction('delete');
    try {
      const ids = [...selected];
      await api.deleteObservations(ids);
      setSelected(new Set());
      setConfirmBulk(false);
      await load(farmerId, fromDate, toDate, sourceFilter);
      setError(null);
    } catch (e: any) {
      setError(e.message || '一括削除に失敗しました');
    } finally {
      setBulkAction(null);
    }
  };

  const exportCsv = async (onlySelected: boolean) => {
    setBulkAction('export');
    try {
      if (onlySelected && selected.size > 0) {
        // Filter to selected ids on the client isn't supported by the export endpoint;
        // export all (bounded) then let user filter in a spreadsheet.
        // For accuracy fall back to a one-by-one approach is overkill; export all matching filters.
      }
      await api.exportObservations({
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        source_type: sourceFilter === 'all' ? undefined : sourceFilter,
        farmer_id: isAdmin ? farmerId ?? undefined : undefined,
        tree_id: treeId || undefined,
      });
    } catch (e: any) {
      setError(e.message || 'エクスポートに失敗しました');
    } finally {
      setBulkAction(null);
    }
  };

  const filterActive = stateFilter !== 'all' || sourceFilter !== 'all' || search !== '' || !!fromDate || !!toDate;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <PageHeader
        title="観測記録"
        description="動画・画像の解析で保存された観測記録を時系列で一覧表示します。絞り込み・一括操作に対応。"
      />

      {error && <ErrorNotice message={error} />}

      {treeId && (
        <div className="mb-4 text-xs">
          <Link
            href={
              isAdmin && farmerId != null
                ? `/farm-map?tree=${encodeURIComponent(treeId)}&farmer_id=${farmerId}`
                : `/farm-map?tree=${encodeURIComponent(treeId)}`
            }
            className="inline-flex items-center gap-1 rounded-lg border border-olive-200 bg-olive-50 px-2.5 py-1.5 font-medium text-olive-700 transition-colors hover:bg-olive-100"
          >
            <IconChevronRight size={14} className="rotate-180" />
            農園マップへ戻る（{treeId}）
          </Link>
        </div>
      )}

      {/* Filter bar */}
      <section className="card mb-6 overflow-visible">
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select
              value={farmerId ?? ''}
              onChange={(e) => setFarmerId(e.target.value === '' ? null : Number(e.target.value))}
              className="input rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
              aria-label="農家で絞り込み"
            >
              <option value="">全農家</option>
              {farmers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.farm_name || f.display_name || f.username}
                  {f.farm_name && f.display_name ? `（${f.display_name}）` : ''}
                </option>
              ))}
            </select>
          )}

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="input rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            aria-label="ソースで絞り込み"
          >
            <option value="all">すべてのソース（{obs.length}）</option>
            <option value="video">動画（{sourceCounts.video}）</option>
            <option value="image">画像（{sourceCounts.image}）</option>
          </select>

          <select
            value={treeId ?? ''}
            onChange={(e) => setTreeId(e.target.value || null)}
            className="input rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            aria-label="樹木で絞り込み"
          >
            <option value="">すべての樹木（{trees.length}件）</option>
            {trees.map((t) => (
              <option key={t.tree_id} value={t.tree_id}>
                {t.tree_id}（{t.observation_count}件）
              </option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ファイル名・農家で検索…"
            className="input flex-1 min-w-32 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm md:max-w-xs"
          />

          <div className="flex items-center gap-1.5">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="input rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm" aria-label="開始日" />
            <span className="text-neutral-400">〜</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="input rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm" aria-label="終了日" />
          </div>

          {filterActive && (
            <button
              onClick={() => {
                setStateFilter('all'); setSourceFilter('all'); setSearch('');
                setFromDate(''); setToDate(''); setFarmerId(null); setTreeId(null);
              }}
              className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-50"
            >
              クリア
            </button>
          )}
        </div>

        {/* state chips */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip active={stateFilter === 'all'} onClick={() => setStateFilter('all')} label={`すべて（${obs.length}）`} />
          {STATE_ORDER.map((k) => (
            <Chip key={k} active={stateFilter === k} onClick={() => setStateFilter(stateFilter === k ? 'all' : k)}
              label={`${healthJa(k)}（${counts[k]}）`} color={healthColor(k)} />
          ))}
        </div>
      </section>

      {/* Summary metrics */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="観測記録" value={String(obs.length)} />
        <Metric label="健康・良好" value={String(counts.happy + counts.good)} sub={`健康 ${counts.happy} / 良好 ${counts.good}`} color={healthColor('happy')} />
        <Metric label="注意" value={String(counts.caution)} color={healthColor('caution')} />
        <Metric label="要管理" value={String(counts.danger)} color={healthColor('danger')} />
      </section>

      {/* Trend chart */}
      {isAdmin && farmerId == null ? (
        <section className="card mb-6 p-4 text-center text-sm text-neutral-400">
          農家を選択すると、その農家の健康スコアの推移グラフが表示されます（農家アカウントと同じ描き方です）。
        </section>
      ) : (
        sorted.length > 1 && (
          <section className="mb-6">
            <div className="card p-4">
              <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-neutral-500">
                <span>健康スコアの推移</span>
                <span className="text-xs font-normal text-neutral-400">表示中 {filtered.length} / {obs.length}件</span>
              </h3>
              <TrendChart obs={sorted} />
            </div>
          </section>
        )
      )}

      {/* Result count + bulk toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-neutral-500">
          {loading ? '読み込み中…' : `${filtered.length}件を表示`}
        </div>
        {!loading && filtered.length > 0 && (
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <>
                <span className="text-sm text-neutral-600">{selected.size}件選択中</span>
                <button onClick={() => setConfirmBulk(true)} disabled={bulkAction !== null}
                  className="inline-flex items-center gap-1 rounded-md bg-health-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                  <IconTrash size={14} /> {bulkAction === 'delete' ? '削除中…' : '選択を削除'}
                </button>
                <button onClick={toggleAll} className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
                  選択解除
                </button>
              </>
            )}
            <button onClick={() => exportCsv(false)} disabled={bulkAction !== null}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
              <IconDownload size={14} /> CSVエクスポート
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card text-center text-sm text-neutral-400">読み込み中…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-sm text-neutral-400">
          {filterActive
            ? 'この条件に一致する観測記録はありません。'
            : 'まだ観測記録がありません。ダッシュボードから動画・画像を解析すると、ここに記録が蓄積されます。'}
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          {/* header row */}
          <div className="hidden items-center gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-2.5 text-xs font-medium text-neutral-500 md:flex">
            <button onClick={toggleAll} aria-label="全選択" className="flex items-center gap-1 hover:text-neutral-800">
              <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                onChange={toggleAll} className="h-4 w-4 rounded" onClick={(e) => e.stopPropagation()} />
            </button>
            <span className="w-20 shrink-0">状態</span>
            <span className="w-16 shrink-0 text-right">スコア</span>
            <span className="flex-1 min-w-0">ファイル / 日時</span>
            {isAdmin && <span className="w-28 shrink-0">農家</span>}
            <span className="hidden w-24 shrink-0 text-right lg:block">葉 / 果実</span>
            <span className="w-14 shrink-0"></span>
          </div>

          {filtered.map((o) => {
            const st = stateOf(o);
            const open = expanded === o.id;
            const score = obsScore(o);
            const src = o.source_type || (o.image_id ? 'image' : 'video');
            const thumb = src === 'image' ? o.raw_frame_path : o.annotated_path || o.raw_frame_path;
            const isSelected = selected.has(o.id);
            return (
              <div key={o.id} className="border-b border-neutral-100 last:border-0">
                <div
                  className={`group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-olive-50/60' : hoverCls}`}
                  onClick={() => setExpanded(open ? null : o.id)}
                >
                  {/* checkbox */}
                  <button onClick={(e) => { e.stopPropagation(); toggleSelect(o.id); }} aria-label="選択"
                    className="shrink-0">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(o.id)}
                      onClick={(e) => e.stopPropagation()} className="h-4 w-4 rounded" />
                  </button>

                  {/* state pill */}
                  <span className="w-20 shrink-0"><StatePill label={healthJa(st)} color={healthColor(st)} /></span>

                  {/* score */}
                  <span className="w-16 shrink-0 text-right font-mono text-sm font-semibold"
                    style={{ color: healthColor(st) }}>
                    {score != null ? (score * 100).toFixed(0) : '—'}
                  </span>

                  {/* thumb + filename */}
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="relative hidden h-11 w-16 shrink-0 overflow-hidden rounded-md bg-neutral-100 sm:block">
                      {thumb ? (
                        <img src={thumb} alt={o.filename || `観測 #${o.id}`} className="h-full w-full object-cover"
                          loading="lazy" onError={(e) => { (e.currentTarget.style.display = 'none'); }} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[9px] text-neutral-300">no img</span>
                      )}
                      <span className="absolute left-0.5 top-0.5 rounded bg-black/50 px-1 text-[9px] font-medium text-white">
                        {src === 'image' ? '画像' : '動画'}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-neutral-800">
                        {o.filename || `観測 #${o.id}`}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="block text-xs text-neutral-400">{fmtDateTime(o.observed_at)}</span>
                        {o.tree_id && (
                          <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            {o.tree_id}
                          </span>
                        )}
                      </span>
                    </span>
                  </span>

                  {isAdmin && (
                    <span className="hidden w-28 shrink-0 md:block">
                      {o.owner && ownerLabel(o.owner) ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-olive-50 px-1.5 py-0.5 text-[11px] text-olive-700">
                          <IconUser size={12} aria-hidden /> {ownerLabel(o.owner)}
                        </span>
                      ) : '—'}
                    </span>
                  )}

                  <span className="hidden w-24 shrink-0 text-right text-xs text-neutral-500 lg:block">
                    {o.leaf_count ?? '—'} / {o.fruit_count ?? '—'}
                  </span>

                  {/* expand toggle */}
                  <span className={`w-4 shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                </div>

                {/* detail (collapsed) */}
                {open && (
                  <div className="border-t border-neutral-100 bg-neutral-50/50 px-4 py-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-neutral-700">解析の詳細</span>
                      <button onClick={() => setConfirmSingle(o)} disabled={removing === o.id}
                        className="inline-flex items-center gap-1 rounded-md bg-health-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                        <IconTrash size={14} /> {removing === o.id ? '削除中…' : 'この記録を削除'}
                      </button>
                    </div>
                    <ObservationDetail obs={o} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <ConfirmDialog
        open={confirmSingle != null}
        title="観測記録を削除"
        message={confirmSingle ? (
          <>
            観測記録「<span className="font-medium">{confirmSingle.filename || `観測 #${confirmSingle.id}`}</span>」を削除します。よろしいですか？
            <br />
            <span className="text-neutral-400">この操作は取り消せません。</span>
          </>
        ) : null}
        confirmLabel="削除する"
        busy={removing === confirmSingle?.id}
        onConfirm={() => confirmSingle && editRemove(confirmSingle)}
        onCancel={() => { if (!removing) setConfirmSingle(null); }}
      />

      <ConfirmDialog
        open={confirmBulk}
        title="選択した記録を削除"
        message={
          <>
            <span className="font-medium">{selected.size}</span> 件の観測記録を削除します。よろしいですか？
            <br />
            <span className="text-neutral-400">この操作は取り消せません。</span>
          </>
        }
        confirmLabel="削除する"
        busy={bulkAction === 'delete'}
        onConfirm={bulkDelete}
        onCancel={() => { if (bulkAction !== 'delete') setConfirmBulk(false); }}
      />
    </div>
  );
}

const hoverCls = 'hover:bg-neutral-50';

function Chip({ active, onClick, label, color }: {
  active: boolean; onClick: () => void; label: string; color?: string;
}) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'text-white' : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
      }`}
      style={active ? { background: color ?? '#2b2b2b' } : undefined}>
      {!active && color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );
}

function Metric({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="card">
      <p className="stat-label">{label}</p>
      <p className="mt-1 stat-value" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="mt-1 text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}
