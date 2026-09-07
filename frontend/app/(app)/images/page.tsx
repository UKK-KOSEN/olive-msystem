'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ImageAsset, Observation, SoilMoistureInput, SoilMoistureData } from '@/lib/api';
import { healthJa, healthColor } from '@/components/charts';
import { SoilDisplay, SoilInputPanel } from '@/components/SoilComponent';
import { ObservationDetail } from '@/components/ObservationDetail';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconImage } from '@/components/icons';

function StatusBadge({ status }: { status: ImageAsset['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: '未解析', cls: 'bg-neutral-100 text-neutral-600' },
    processing: { label: '解析中', cls: 'bg-olive-50 text-olive-700' },
    done: { label: '完了', cls: 'bg-health-good/10 text-health-good' },
    error: { label: 'エラー', cls: 'bg-health-danger/10 text-health-danger' },
  };
  const m = map[status] || map.pending;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImageAnalysisPage() {
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [runProgress, setRunProgress] = useState<{ imageId: number; startTime: number; estSeconds: number } | null>(null);
  const [results, setResults] = useState<Record<number, Observation>>({});
  const [soilInputs, setSoilInputs] = useState<Record<number, SoilMoistureInput | undefined>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ImageAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | ImageAsset['status']>('all');

  const statusOrder: { key: 'all' | ImageAsset['status']; label: string }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'pending', label: '未解析' },
    { key: 'processing', label: '解析中' },
    { key: 'done', label: '完了' },
    { key: 'error', label: 'エラー' },
  ];

  const shown = useMemo(
    () => (statusFilter === 'all' ? images : images.filter((i) => i.status === statusFilter)),
    [images, statusFilter]
  );

  // Elapsed time ticker
  useEffect(() => {
    if (!runProgress) { setElapsed(0); return; }
    const start = runProgress.startTime;
    const tick = () => setElapsed((Date.now() - start) / 1000);
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [runProgress]);

  const load = useCallback(async () => {
    const imgs = await api.images().catch(() => [] as ImageAsset[]);
    setImages(imgs);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    setUploadError(null);
    try {
      for (const f of files) {
        await api.uploadImage(f);
      }
      await load();
    } catch (e: any) {
      setUploadError(e.message || 'アップロードに失敗しました');
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
      await load();
    } catch (e: any) {
      setError(e.message || '削除に失敗しました');
    } finally {
      setRemoving(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) handleFiles(files);
  };

  const runImage = async (img: ImageAsset, soil?: SoilMoistureInput) => {
    setError(null);
    setRunning(img.id);
    // Estimate analysis time: ~1s per 100KB, min 3s, max 30s
    const estSeconds = Math.max(3, Math.min(30, Math.round((img.size_bytes || 100000) / 100000)));
    setRunProgress({ imageId: img.id, startTime: Date.now(), estSeconds });
    try {
      const data = await api.analyseImage(img.id, soil);
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <PageHeader
        title="画像解析"
        description="静止画像を1枚ずつアップロードし、オリーブの体調を即時解析します。"
      />

      {/* KPI */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi value={String(images.length)} label="登録画像" />
        <Kpi value={String(images.filter((i) => i.status === 'done').length)} label="解析済み" />
        <Kpi value={String(Object.keys(results).length)} label="結果表示中" />
        <Kpi value={String(images.filter((i) => i.status === 'error').length)} label="エラー" />
      </section>

      <section className="card mb-6">
        <h2 className="label mb-3">画像を追加</h2>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center transition-colors hover:border-neutral-400 hover:bg-neutral-100/60"
        >
          <IconImage size={30} className="text-neutral-400" />
          <p className="text-sm font-medium text-neutral-700">
            {uploading ? 'アップロード中…' : 'クリックまたはドラッグして画像を追加'}
          </p>
          <p className="text-xs text-neutral-400">複数ファイル対応（JPG / PNG / BMP / TIFF / WebP）</p>
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
          <p className="mt-3 rounded-lg bg-health-danger/10 px-3 py-2 text-sm text-health-danger">
            {uploadError || error}
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="label">登録済みの画像</h2>
            <span className="badge bg-neutral-100 text-neutral-600">{images.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
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
        </div>

        {shown.length === 0 ? (
          <div className="empty-state">
            <IconImage size={36} className="text-neutral-300" />
            <p className="empty-title">
              {images.length === 0 ? 'まだ画像がありません' : `「${statusOrder.find((f) => f.key === statusFilter)?.label}」の画像はありません`}
            </p>
            {images.length === 0 && (
              <p className="empty-desc">上の領域から画像を追加してください。</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map((img) => {
              const res = results[img.id];
              const open = expanded === img.id;
              const annotatedUrl = (res?.result?.['_frame_annotated_url'] as string) || null;
              return (
                <div key={img.id} className="card">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <button
                      onClick={() => setExpanded(open ? null : img.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      {annotatedUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={annotatedUrl}
                          alt="解析結果"
                          className="h-11 w-16 shrink-0 rounded-md object-cover ring-1 ring-neutral-200"
                        />
                      ) : (
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600">
                          <IconImage size={20} />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-neutral-800">
                          {img.filename}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-neutral-400">
                          <span>{fmtBytes(img.size_bytes)}</span>
                          <span>{img.created_at}</span>
                        </span>
                      </span>
                    </button>
                    <StatusBadge status={img.status} />
                    <button
                      onClick={() => runImage(img)}
                      disabled={running === img.id}
                      className="btn-primary"
                    >
                      {running === img.id ? '解析中…' : '解析'}
                    </button>
                    <button
                      onClick={() => setConfirmRemove(img)}
                      disabled={removing === img.id}
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
                          <div className="mt-2">
                            <button
                              onClick={() => runImage(img, soilInputs[img.id])}
                              disabled={running === img.id}
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
                          <ObservationDetail obs={res} />
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
        )}
      </section>

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
    </div>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="card card-hover">
      <p className="stat-label">{label}</p>
      <p className="mt-1 stat-value">{value}</p>
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
