'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ImageAsset, Observation, SoilMoistureInput } from '@/lib/api';
import { healthJa, healthColor, STATE_ORDER, stateOf, obsScore } from '@/components/charts';
import { SoilDisplay, SoilInputPanel } from '@/components/SoilComponent';
import { ObservationDetail } from '@/components/ObservationDetail';
import { UpscaledBadge } from '@/components/UpscaledBadge';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import ErrorNotice from '@/components/ErrorNotice';
import { IconImage, IconTrash } from '@/components/icons';
import { Snackbar } from '@/components/Snackbar';
import { fmtBytes, fmtDate } from '@/lib/format';

const SEARCH_CONCURRENCY = 4;

function originalUrl(img: ImageAsset): string {
  return `/media/${encodeURIComponent(img.filename)}`;
}

function annotatedUrlOf(obs: Observation | undefined): string | null {
  return (obs?.result?.['_frame_annotated_url'] as string) || null;
}

/** Latest observation by observed_at (string compare is safe for ISO-8601). */
function latestOf(list: Observation[]): Observation | null {
  if (list.length === 0) return null;
  return list.reduce((a, b) => ((b.observed_at || '').localeCompare(a.observed_at || '') > 0 ? b : a));
}

export default function ImageAnalysisPage() {
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [runProgress, setRunProgress] = useState<{ imageId: number; startTime: number; estSeconds: number } | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; startTime: number } | null>(null);
  const [results, setResults] = useState<Record<number, Observation>>({});
  const [soilInputs, setSoilInputs] = useState<Record<number, SoilMoistureInput | undefined>>({});
  const [treeInputs, setTreeInputs] = useState<Record<number, string>>({});
  const [droneFlags, setDroneFlags] = useState<Record<number, boolean>>({});
  const [upscaleFlags, setUpscaleFlags] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ImageAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ImageAsset['status']>('all');
  const [snackbar, setSnackbar] = useState<{ message: string; kind: 'ok' | 'err' } | null>(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'new' | 'old' | 'name'>('new');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  // shared batch settings
  const [batchSoil, setBatchSoil] = useState<SoilMoistureInput | undefined>(undefined);
  const [batchTree, setBatchTree] = useState('');
  const [batchDrone, setBatchDrone] = useState(false);
  const [batchUpscale, setBatchUpscale] = useState(false);

  const statusOrder: { key: 'all' | ImageAsset['status']; label: string }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'pending', label: '未解析' },
    { key: 'processing', label: '解析中' },
    { key: 'done', label: '完了' },
    { key: 'error', label: 'エラー' },
  ];

  const shown = useMemo(() => {
    let arr = statusFilter === 'all' ? images : images.filter((i) => i.status === statusFilter);
    const q = query.trim().toLowerCase();
    if (q) arr = arr.filter((i) => i.filename.toLowerCase().includes(q));
    const out = [...arr];
    if (sortBy === 'new') out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    else if (sortBy === 'old') out.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    else out.sort((a, b) => a.filename.localeCompare(b.filename));
    return out;
  }, [images, statusFilter, query, sortBy]);

  // Average + distribution over analysed results (persisted + current session).
  const stats = useMemo(() => {
    const list = Object.values(results);
    let sum = 0;
    let n = 0;
    const counts: Record<string, number> = { happy: 0, good: 0, caution: 0, danger: 0 };
    for (const o of list) {
      const s = obsScore(o);
      if (s == null) continue;
      sum += s;
      n += 1;
      const l = stateOf(o);
      if (counts[l] != null) counts[l] += 1;
    }
    return { avg: n > 0 ? sum / n : null, issues: counts.caution + counts.danger, counts, n };
  }, [results]);

  // Elapsed time ticker (single analysis)
  useEffect(() => {
    if (!runProgress) { setElapsed(0); return; }
    const start = runProgress.startTime;
    const tick = () => setElapsed((Date.now() - start) / 1000);
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [runProgress]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const imgs = await api.images();
      setImages(imgs);
    } catch (e: any) {
      setLoadError(e?.message || '画像データの取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Restore the latest stored observation for completed images so results
  // survive a page reload (concurrency limited).
  useEffect(() => {
    if (!images.length) return;
    const doneIds = images.filter((i) => i.status === 'done' && !results[i.id]).map((i) => i.id);
    if (!doneIds.length) return;
    let cancelled = false;
    let cursor = 0;
    const worker = async () => {
      while (cursor < doneIds.length && !cancelled) {
        const id = doneIds[cursor++];
        try {
          const list = await api.imageObservations(id);
          const latest = latestOf(list);
          if (latest) {
            setResults((prev) => (prev[id] ? prev : { ...prev, [id]: latest }));
          }
        } catch {
          // skip images without readable observations
        }
      }
    };
    const workers = Array.from({ length: Math.min(SEARCH_CONCURRENCY, doneIds.length) }, () => worker());
    return () => { cancelled = true; void Promise.all(workers).catch(() => {}); };
  }, [images, results]);

  // Auto refresh while any job is still processing.
  useEffect(() => {
    if (!images.some((i) => i.status === 'processing')) return;
    const id = setInterval(() => load(), 6000);
    return () => clearInterval(id);
  }, [images, load]);

  // Keyboard navigation for the lightbox.
  useEffect(() => {
    if (lightboxIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      if (e.key === 'ArrowRight') setLightboxIdx((i) => (i == null ? i : (i + 1) % Math.max(1, shown.length)));
      if (e.key === 'ArrowLeft') setLightboxIdx((i) => (i == null ? i : (i - 1 + shown.length) % Math.max(1, shown.length)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIdx, shown.length]);

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    setUploadError(null);
    setInfo(null);
    try {
      for (const f of files) {
        await api.uploadImage(f);
      }
      await load();
      setSnackbar({ message: `${files.length} 件の画像をアップロードしました`, kind: 'ok' });
    } catch (e: any) {
      setUploadError(e.message || 'アップロードに失敗しました');
      setSnackbar({ message: e.message || 'アップロードに失敗しました', kind: 'err' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = async (img: ImageAsset) => {
    setRemoving(img.id);
    try {
      await api.deleteOwnImage(img.id);
      if (expanded === img.id) setExpanded(null);
      setConfirmRemove(null);
      if (lightboxIdx != null) setLightboxIdx(null);
      setResults((prev) => {
        if (!(img.id in prev)) return prev;
        const next = { ...prev };
        delete next[img.id];
        return next;
      });
      setSoilInputs((prev) => {
        if (!(img.id in prev)) return prev;
        const next = { ...prev };
        delete next[img.id];
        return next;
      });
      await load();
      setSnackbar({ message: '画像を削除しました', kind: 'ok' });
    } catch (e: any) {
      setError(e.message || '削除に失敗しました');
      setSnackbar({ message: e.message || '削除に失敗しました', kind: 'err' });
    } finally {
      setRemoving(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) handleFiles(files);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const runImage = async (img: ImageAsset, soil?: SoilMoistureInput, treeId?: string, droneMode = false, upscale = false) => {
    setError(null);
    setInfo(null);
    setRunning(img.id);
    const estSeconds = Math.max(3, Math.min(30, Math.round((img.size_bytes || 100000) / 100000)));
    setRunProgress({ imageId: img.id, startTime: Date.now(), estSeconds: upscale ? estSeconds * 2 : estSeconds });
    try {
      const data = await api.analyseImage(img.id, soil, treeId, droneMode, upscale);
      if (data?.observation) {
        setResults((prev) => ({ ...prev, [img.id]: data.observation }));
      }
      setExpanded(img.id);
      await load();
    } catch (e: any) {
      setError(e.message || '解析に失敗しました');
    } finally {
      setRunning(null);
      setRunProgress(null);
    }
  };

  // ---- batch operations ----
  const selectedImages = useMemo(() => shown.filter((i) => selectedIds.has(i.id)), [shown, selectedIds]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const ids = shown.map((i) => i.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      if (all) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const runBatch = async () => {
    const targets = [...selectedImages];
    if (!targets.length || batchBusy) return;
    setError(null);
    setInfo(null);
    setBatchBusy(true);
    const start0 = Date.now();
    setBatchProgress({ done: 0, total: targets.length, startTime: start0 });
    let ok = 0;
    const fails: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const img = targets[i];
      setRunning(img.id);
      try {
        const data = await api.analyseImage(img.id, batchSoil, batchTree.trim() || undefined, batchDrone, batchUpscale);
        if (data?.observation) {
          setResults((prev) => ({ ...prev, [img.id]: data.observation }));
        }
        ok += 1;
      } catch (e: any) {
        fails.push(`${img.filename}: ${e?.message || '解析失敗'}`);
      }
      setBatchProgress({ done: i + 1, total: targets.length, startTime: start0 });
    }
    await load();
    setRunning(null);
    setBatchProgress(null);
    setBatchBusy(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    if (fails.length === 0) {
      setInfo(`一括解析が完了しました（${ok}件すべて成功）`);
    } else {
      setInfo(`一括解析の完了: ${ok}件成功 / ${fails.length}件失敗（失敗分: ${fails.join(' / ')}）`);
    }
  };

  const runBatchDelete = async () => {
    const targets = [...selectedImages];
    if (!targets.length) return;
    setBatchBusy(true);
    let fails = 0;
    const removed: number[] = [];
    for (const img of targets) {
      try {
        await api.deleteOwnImage(img.id);
        removed.push(img.id);
      } catch {
        fails += 1;
      }
    }
    if (removed.length) {
      setResults((prev) => {
        const next = { ...prev };
        for (const id of removed) delete next[id];
        return next;
      });
    }
    setConfirmBatchDelete(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    await load();
    setBatchBusy(false);
    setInfo(fails === 0 ? `一括削除が完了しました（${targets.length}件）` : `削除完了: ${targets.length - fails}件 / 失敗 ${fails}件`);
  };

  const handleBatchDrone = (v: boolean) => {
    setBatchDrone(v);
    if (v && !batchUpscale) setBatchUpscale(true);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <PageHeader
        title="画像解析"
        description="静止画像をアップロードし、オリーブの体調を即時解析します。解析済みの結果は自動で保存・再表示されます。"
      />

      {/* KPI */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi value={String(images.length)} label="登録画像" />
        <Kpi value={String(images.filter((i) => i.status === 'done').length)} label="解析済み" />
        <Kpi value={stats.avg != null ? `${Math.round(stats.avg * 100)}点` : '—'} label="平均スコア" />
        <Kpi value={String(stats.issues)} label="注意・要管理" color={stats.issues > 0 ? healthColor('danger') : undefined} />
      </section>

      {/* health distribution of analysed images */}
      {stats.n > 0 && (
        <section className="mb-6 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            {STATE_ORDER.map((k) =>
              stats.counts[k] > 0 ? (
                <div
                  key={k}
                  className="h-full transition-all"
                  style={{ width: `${(stats.counts[k] / stats.n) * 100}%`, background: healthColor(k) }}
                />
              ) : null
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {STATE_ORDER.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
                <span className="h-2 w-2 rounded-full" style={{ background: healthColor(k) }} />
                {healthJa(k)}
                <span className="tabular-nums font-medium text-neutral-700">{stats.counts[k]}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="card mb-6">
        <h2 className="label mb-3">画像を追加</h2>
        <div
          ref={dropZoneRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="button"
          aria-label="画像をアップロード"
          aria-describedby="upload-desc"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center transition-colors hover:border-neutral-400 hover:bg-neutral-100/60 focus:outline-none focus:ring-2 focus:ring-olive-500 focus:ring-offset-2"
        >
          <IconImage size={30} className="text-neutral-400" />
          <p className="text-sm font-medium text-neutral-700">
            {uploading ? 'アップロード中…' : 'クリック、ドラッグ、または Enter キーで画像を追加'}
          </p>
          <p id="upload-desc" className="text-xs text-neutral-400">
            複数ファイル対応（JPG / PNG / BMP / TIFF / WebP）最大 50MB まで
          </p>
          {uploading && (
            <div className="flex items-center gap-2 text-xs text-neutral-500" role="status" aria-live="polite">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-olive-600 border-t-transparent" />
              アップロードしています…
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.jpg,.jpeg,.png,.bmp,.tif,.tiff,.webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) handleFiles(files);
            }}
          />
        </div>
        {(uploadError || error) && (
          <ErrorNotice message={uploadError || error} />
        )}
        {info && (
          <div className="mt-3 rounded-lg bg-olive-50 px-3 py-2.5 text-sm text-olive-800">{info}</div>
        )}
      </section>

      {snackbar && (
        <Snackbar message={snackbar.message} kind={snackbar.kind} onClose={() => setSnackbar(null)} />
      )}

      {loadError && (
        <ErrorNotice message={loadError} onRetry={load} />
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="label">登録済みの画像</h2>
            <span className="badge bg-neutral-100 text-neutral-600">{images.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5">
              {statusOrder.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`badge transition-colors ${
                    statusFilter === f.key
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <svg
                width="13"
                height="13"
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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ファイル名で検索"
                className="w-36 rounded-lg border border-neutral-300 bg-white py-1.5 pl-7 pr-2 text-xs focus:border-olive-500 focus:outline-none"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-600 focus:border-olive-500 focus:outline-none"
              aria-label="並び替え"
            >
              <option value="new">新しい順</option>
              <option value="old">古い順</option>
              <option value="name">ファイル名順</option>
            </select>
            <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
              {(['list', 'grid'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-2.5 py-1.5 font-medium transition-colors ${
                    view === v ? 'bg-olive-700 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {v === 'list' ? '一覧' : 'ギャラリー'}
                </button>
              ))}
            </div>
            {!selectMode ? (
              <button
                type="button"
                onClick={() => {
                  setSelectMode(true);
                  setSelectedIds(new Set());
                }}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
              >
                一括操作
              </button>
            ) : (
              <span className="rounded-full bg-olive-100 px-3 py-1 text-xs font-medium text-olive-700">
                {selectedIds.size}件選択
              </span>
            )}
          </div>
        </div>

        {selectMode && (
          <div className="card mb-3">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={selectAll} className="btn-secondary btn-sm">
                {shown.every((i) => selectedIds.has(i.id)) && shown.length > 0 ? '選択を解除' : `表示中の${shown.length}件を選択`}
              </button>
              <span className="text-xs text-neutral-500">一括解析の共通設定:</span>
              <div className="flex flex-wrap items-center gap-2">
                <SoilInputPanel onChange={setBatchSoil} />
                <input
                  type="text"
                  value={batchTree}
                  onChange={(e) => setBatchTree(e.target.value)}
                  placeholder="樹木ID（全選択分に適用）"
                  className="input w-52 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                />
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-600">
                  <input type="checkbox" checked={batchDrone} onChange={(e) => handleBatchDrone(e.target.checked)} className="h-3.5 w-3.5 accent-olive-600" />
                  ドローン
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-600">
                  <input type="checkbox" checked={batchUpscale} onChange={(e) => setBatchUpscale(e.target.checked)} className="h-3.5 w-3.5 accent-violet-600" />
                  4倍高解像度
                </label>
              </div>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={runBatch}
                  disabled={batchBusy || selectedImages.length === 0}
                  className="btn-primary disabled:opacity-40"
                >
                  {batchBusy ? '解析中…' : `選択分を解析（${selectedImages.length}件）`}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBatchDelete(true)}
                  disabled={batchBusy || selectedImages.length === 0}
                  className="btn-danger disabled:opacity-40"
                >
                  選択分を削除
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (batchBusy) return;
                    setSelectMode(false);
                    setSelectedIds(new Set());
                  }}
                  disabled={batchBusy}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                >
                  解除
                </button>
              </div>
            </div>
            {batchProgress && <BatchProgress done={batchProgress.done} total={batchProgress.total} />}
          </div>
        )}

        {shown.length === 0 ? (
          <div className="empty-state" role="status" aria-live="polite">
            <IconImage size={36} className="text-neutral-300" aria-hidden="true" />
            <p className="empty-title">
              {images.length === 0 ? 'まだ画像がありません' : `「${statusOrder.find((f) => f.key === statusFilter)?.label}」の画像はありません`}
            </p>
            {images.length === 0 && (
              <p className="empty-desc">上の領域から画像を追加してください。</p>
            )}
            {images.length > 0 && (
              <button
                onClick={() => setStatusFilter('all')}
                className="mt-3 btn-secondary btn-sm"
                aria-label="すべての画像を表示"
              >
                すべての画像を表示
              </button>
            )}
          </div>
        ) : view === 'list' ? (
          <div className="space-y-3">
            {shown.map((img) => {
              const res = results[img.id];
              const open = expanded === img.id;
              const annotatedUrl = annotatedUrlOf(res);
              return (
                <div key={img.id} className="card">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    {selectMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(img.id)}
                        onChange={() => toggleSelect(img.id)}
                        className="h-4 w-4 accent-olive-700"
                        aria-label={`${img.filename} を選択`}
                      />
                    )}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpanded(open ? null : img.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpanded(open ? null : img.id);
                        }
                      }}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                    >
                      <span className="shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const idx = shown.findIndex((s) => s.id === img.id);
                            setLightboxIdx(idx >= 0 ? idx : null);
                          }}
                          className="shrink-0"
                          aria-label="画像を拡大"
                        >
                        {annotatedUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={annotatedUrl}
                            alt="解析結果サムネイル"
                            className="h-11 w-16 shrink-0 rounded-md object-cover ring-1 ring-violet-200"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={originalUrl(img)}
                            alt={img.filename}
                            className="h-11 w-16 shrink-0 rounded-md border border-neutral-200 object-cover"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                      </button>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-neutral-800" title={img.filename}>
                          {img.filename}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-neutral-400">
                          <span>{fmtBytes(img.size_bytes)}</span>
                          <span>{fmtDate(img.created_at)}</span>
                        </span>
                      </span>
                    </div>
                    {res && (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-bold"
                        style={{ background: healthColor(stateOf(res)) + '22', color: healthColor(stateOf(res)) }}
                      >
                        {healthJa(stateOf(res))}
                      </span>
                    )}
                    <StatusBadge status={img.status} pendingLabel="未解析" />
                    <button
                      onClick={() => runImage(img)}
                      disabled={running === img.id || batchBusy}
                      className="btn-primary"
                    >
                      {running === img.id ? '解析中…' : '解析'}
                    </button>
                    <button
                      onClick={() => setConfirmRemove(img)}
                      disabled={removing === img.id || batchBusy}
                      className="btn-danger"
                    >
                      {removing === img.id ? '削除中…' : '削除'}
                    </button>
                  </div>

                  {open && (
                    <div className="mt-4 border-t border-neutral-100 pt-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <SoilInputPanel
                            onChange={(v) => setSoilInputs((prev) => ({ ...prev, [img.id]: v }))}
                          />
                          <div className="mt-2.5 space-y-2">
                            <input
                              type="text"
                              value={treeInputs[img.id] ?? ''}
                              onChange={(e) => setTreeInputs((prev) => ({ ...prev, [img.id]: e.target.value }))}
                              placeholder="樹木ID（例: 第3試験樹・空欄でQR自動認識）"
                              className="input w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                            />
                            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-neutral-600">
                              <input
                                type="checkbox"
                                checked={droneFlags[img.id] ?? false}
                                onChange={(e) => {
                                  setDroneFlags((prev) => ({ ...prev, [img.id]: e.target.checked }));
                                  if (e.target.checked && !upscaleFlags[img.id]) {
                                    setUpscaleFlags((prev) => ({ ...prev, [img.id]: true }));
                                  }
                                }}
                                className="h-4 w-4 rounded accent-olive-600"
                              />
                              ドローン撮影（低解像度・上空からの画像）
                            </label>
                            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2.5 transition-colors hover:bg-violet-50">
                              <input
                                type="checkbox"
                                checked={upscaleFlags[img.id] ?? false}
                                onChange={(e) => setUpscaleFlags((prev) => ({ ...prev, [img.id]: e.target.checked }))}
                                className="mt-0.5 h-4 w-4 rounded accent-violet-600"
                              />
                              <span>
                                <span className="font-semibold text-violet-800">高解像度解析（4倍）</span>
                                <span className="mt-0.5 block text-[10px] leading-snug text-violet-600">
                                  低解像度の画像を4倍に高画質化してから解析します。高解像度でも精度よく検出できます（処理時間がかかります）。
                                </span>
                              </span>
                            </label>
                          </div>
                          <div className="mt-2">
                            <button
                              onClick={() => runImage(img, soilInputs[img.id], treeInputs[img.id]?.trim() || undefined, droneFlags[img.id] ?? false, upscaleFlags[img.id] ?? false)}
                              disabled={running === img.id || batchBusy}
                              className="btn-secondary w-full"
                            >
                              {running === img.id ? '解析中…' : '設定値で解析'}
                            </button>
                          </div>
                        </div>
                        {/* Progress overlay during analysis */}
                        {running === img.id && runProgress?.imageId === img.id && (
                          <AnalysisProgress elapsed={elapsed} estSeconds={runProgress.estSeconds} />
                        )}
                        {!running && res ? (
                          <div className="space-y-4">
                            {res.upscaled && (
                              <div className="flex justify-end">
                                <UpscaledBadge model={res.upscale_model} large />
                              </div>
                            )}
                            <ObservationDetail obs={res} />
                          </div>
                        ) : !running && !res ? (
                          <div className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-400">
                            解析結果がまだありません。「解析」を押してください。
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {shown.map((img, idx) => {
              const res = results[img.id];
              const annotatedUrl = annotatedUrlOf(res);
              return (
                <div
                  key={img.id}
                  className={`relative overflow-hidden rounded-xl border shadow-sm transition-shadow hover:shadow-md ${
                    selectMode && selectedIds.has(img.id) ? 'border-olive-600 ring-2 ring-olive-600/40' : 'border-neutral-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => (selectMode ? toggleSelect(img.id) : setLightboxIdx(idx))}
                    className="relative block aspect-[4/3] w-full bg-neutral-100"
                    aria-label={selectMode ? `${img.filename} を選択` : `${img.filename} を拡大表示`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={annotatedUrl || originalUrl(img)}
                      alt={img.filename}
                      className="h-full w-full object-cover"
                      onError={(e) => { e.currentTarget.src = originalUrl(img); }}
                    />
                    {selectMode ? (
                      <span className="absolute inset-0 grid place-items-center bg-black/10">
                        <span
                          className={`grid h-6 w-6 place-items-center rounded-md border-2 bg-white text-xs font-bold ${
                            selectedIds.has(img.id) ? 'border-olive-600 bg-olive-600 text-white' : 'border-neutral-400 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      </span>
                    ) : null}
                    <span className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
                      <StatusBadge status={img.status} pendingLabel="未解析" />
                      {res?.tree_id ? (
                        <span className="rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
                          {res.tree_id}
                        </span>
                      ) : null}
                    </span>
                    {res && (
                      <span
                        className="absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow"
                        style={{ background: healthColor(stateOf(res)) }}
                      >
                        {healthJa(stateOf(res))}
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1 pt-6 text-left text-[11px] font-medium leading-snug text-white line-clamp-2 break-words" title={img.filename}>
                      {img.filename}
                    </span>
                  </button>
                  {!selectMode && (
                    <div className="absolute right-1.5 top-1.5 z-10 flex gap-1">
                      <button
                        type="button"
                        onClick={() => runImage(img)}
                        disabled={running === img.id || batchBusy}
                        className="rounded-md bg-white/90 px-1.5 py-1 text-[10px] font-medium text-neutral-700 shadow-sm transition-colors hover:bg-white disabled:opacity-50"
                      >
                        {running === img.id ? '解析中…' : '解析'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(img)}
                        disabled={removing === img.id || batchBusy}
                        className="grid h-[22px] w-[22px] place-items-center rounded-md bg-white/90 text-neutral-600 shadow-sm transition-colors hover:bg-white disabled:opacity-50"
                        aria-label="削除"
                      >
                        <IconTrash size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Lightbox */}
      {lightboxIdx != null && shown[lightboxIdx] && (
        <Lightbox
          img={shown[lightboxIdx]}
          obs={results[shown[lightboxIdx].id]}
          hasPrev={shown.length > 1}
          hasNext={shown.length > 1}
          onPrev={() => setLightboxIdx((i) => (i == null ? i : (i - 1 + shown.length) % shown.length))}
          onNext={() => setLightboxIdx((i) => (i == null ? i : (i + 1) % shown.length))}
          onClose={() => setLightboxIdx(null)}
          onAnalyse={() => runImage(shown[lightboxIdx])}
          onDelete={() => setConfirmRemove(shown[lightboxIdx])}
          running={running === shown[lightboxIdx].id}
        />
      )}

      <ConfirmDialog
        open={confirmRemove != null}
        title="画像を削除"
        message={confirmRemove ? (
          <>
            画像「<span className="font-medium">{confirmRemove.filename}</span>」と、その解析結果を削除します。よろしいですか？
            <br />
            <span className="text-neutral-400">この操作は取り消せません。</span>
          </>
        ) : null}
        confirmLabel="削除する"
        busy={removing === confirmRemove?.id}
        onConfirm={() => confirmRemove && removeImage(confirmRemove)}
        onCancel={() => { if (!removing) setConfirmRemove(null); }}
      />

      <ConfirmDialog
        open={confirmBatchDelete}
        title="画像を一括削除"
        message={selectedImages.length > 0 ? (
          <>
            選択した <span className="font-medium">{selectedImages.length}</span> 件の画像とその解析結果を削除します。よろしいですか？
            <br />
            <span className="text-neutral-400">この操作は取り消せません。</span>
          </>
        ) : null}
        confirmLabel="一括削除する"
        busy={batchBusy}
        onConfirm={runBatchDelete}
        onCancel={() => { if (!batchBusy) setConfirmBatchDelete(false); }}
      />
    </div>
  );
}

function Lightbox({
  img,
  obs,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onAnalyse,
  onDelete,
  running,
}: {
  img: ImageAsset;
  obs: Observation | undefined;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onAnalyse: () => void;
  onDelete: () => void;
  running: boolean;
}) {
  const annotatedUrl = annotatedUrlOf(obs);
  const src = annotatedUrl || originalUrl(img);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4" onClick={onClose}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={img.filename}>{img.filename}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={img.status} pendingLabel="未解析" />
            {obs ? (
              <>
                {obs.tree_id ? (
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">
                    {obs.tree_id}
                  </span>
                ) : null}
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ background: healthColor(stateOf(obs)) + '33', color: healthColor(stateOf(obs)) }}
                >
                  {healthJa(stateOf(obs))} · {obsScore(obs) != null ? `${Math.round((obsScore(obs) ?? 0) * 100)}点` : ''}
                </span>
                <span className="text-xs text-neutral-300">
                  {obs.observed_at ? new Date(obs.observed_at).toLocaleString('ja-JP') : ''}
                </span>
              </>
            ) : (
              <span className="text-xs text-neutral-400">{running ? '解析中…' : '未解析'}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAnalyse}
            disabled={running}
            className="btn-primary disabled:opacity-50"
          >
            {running ? '解析中…' : '解析'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20"
          >
            削除
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            ×
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {annotatedUrl && (
          <span className="absolute right-3 top-3 z-10">
            <UpscaledBadge model={obs?.upscale_model} />
          </span>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={img.filename}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        {hasPrev && (
          <button
            type="button"
            aria-label="前の画像"
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-2xl text-white transition-colors hover:bg-white/25"
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            aria-label="次の画像"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-2xl text-white transition-colors hover:bg-white/25"
          >
            ›
          </button>
        )}
      </div>

      {obs && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-white/10 p-3 text-xs leading-relaxed text-neutral-200 backdrop-blur-sm">
          {obs.explain_text || (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <span>葉数: {obs.leaf_count ?? '-'}</span>
              <span>果実数: {obs.fruit_count ?? '-'}</span>
              <span>緑度: {obs.green_coverage != null ? `${obs.green_coverage.toFixed(1)}%` : '-'}</span>
              <span>水分ストレス: {obs.water_stress != null ? obs.water_stress.toFixed(2) : '-'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BatchProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="mt-3 rounded-lg border border-olive-200 bg-olive-50 p-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-olive-800">
          一括解析 {done} / {total} 件
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-olive-200">
          <div className="h-full rounded-full bg-olive-600 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs tabular-nums text-olive-700">{pct}%</span>
      </div>
    </div>
  );
}

function Kpi({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="card card-hover">
      <p className="stat-label">{label}</p>
      <p className="mt-1 stat-value" style={color ? { color } : undefined}>{value}</p>
    </div>
  );
}

/**
 * Analysis progress indicator with elapsed time and estimated remaining.
 * Does NOT disappear during analysis - stays visible until completion.
 */
function AnalysisProgress({ elapsed, estSeconds }: { elapsed: number; estSeconds: number }) {
  const pct = Math.min(95, (elapsed / estSeconds) * 100);
  const remaining = Math.max(0, estSeconds - elapsed);
  const fmt = (s: number) => {
    if (s < 60) return `${Math.ceil(s)}秒`;
    const m = Math.floor(s / 60);
    const sec = Math.ceil(s % 60);
    return `${m}分${sec}秒`;
  };

  return (
    <div className="rounded-lg border border-olive-200 bg-olive-50 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-olive-600 border-t-transparent" />
        <span className="text-sm font-medium text-olive-800">解析中です。しばらくお待ちください。</span>
      </div>
      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-olive-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-olive-600 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Time info */}
      <div className="mt-2 flex justify-between text-xs text-olive-700">
        <span>経過: {fmt(elapsed)}</span>
        <span>残り概算: {fmt(remaining)}</span>
      </div>
      <div className="mt-1 text-xs text-olive-500 text-center">
        画像サイズに応じて数秒〜数十秒かかります
      </div>
    </div>
  );
}