'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ActiveJob {
  job_id: number;
  video_id: number;
  status: string;
  progress: number;
  requested: number;
  error?: string | null;
  saved?: number | null;
  stage?: string | null;
  current?: number;
  total?: number;
  current_label?: string | null;
  started_at?: number | null;
  drone_mode?: boolean;
  upscale?: boolean | null;
  tree_id?: string | null;
}

function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const CHECK = (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CLOSE = (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
);

export default function TaskBar() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [prevActiveKeys, setPrevActiveKeys] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const data: ActiveJob[] = await api.videoJobs();
        if (alive) setJobs(Array.isArray(data) ? data : []);
      } catch {
        if (alive) setJobs([]);
      }
    };
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Refresh elapsed-time labels every second.
  useEffect(() => {
    const t = setInterval(() => setTick((c) => c + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const active = jobs.filter((j) => j.status === 'processing' || j.status === 'queued');
  const done = jobs.filter((j) => j.status === 'done');
  const failed = jobs.filter((j) => j.status === 'error');

  // A newly visible active job forces the panel back open so analysis is
  // always surfaced while work is in progress.
  const activeKey = active.map((j) => j.job_id).join(',');
  useEffect(() => {
    if (activeKey && activeKey !== prevActiveKeys) setDismissed(false);
    setPrevActiveKeys(activeKey);
  }, [activeKey, prevActiveKeys]);

  if (jobs.length === 0) return null;
  const hasActive = active.length > 0;
  if (dismissed && !hasActive) return null;

  const badge = hasActive
    ? { cls: 'bg-olive-50 text-olive-800', text: `実行中 ${active.length} 件` }
    : failed.length > 0
      ? { cls: 'bg-neutral-100 text-neutral-700', text: `${failed.length} 件 エラー` }
      : { cls: 'bg-neutral-100 text-neutral-700', text: '解析完了' };

  const now = Date.now() / 1000;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2.5 rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasActive && (
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-olive-500" />
          )}
          <p className="text-sm font-semibold text-neutral-800">解析タスク</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`badge ${badge.cls}`}>{badge.text}</span>
          <button
            onClick={() => setDismissed(true)}
            aria-label="タスクバーを閉じる"
            className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            {CLOSE}
          </button>
        </div>
      </div>

      {active.map((j) => {
        const pct = Math.max(0, Math.min(100, Math.round(j.progress * 100)));
        const queued = j.status === 'queued';
        const saving = j.stage === 'saving';
        const indeterminate = queued || saving || pct === 0;
        const total = j.total || j.requested || 1;
        const current = j.current || 0;
        const elapsed = j.started_at ? now - j.started_at : 0;
        return (
          <div key={j.job_id} className="rounded-lg border border-neutral-100 p-2.5">
            <div className="flex items-center justify-between text-xs font-medium text-neutral-700">
              <span className="truncate">動画 #{j.video_id} の解析</span>
              <span className="tabular-nums text-neutral-600">
                {queued ? '待機中…' : saving ? `${pct}%` : `${pct}%`}
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full bg-olive-700 transition-[width] duration-500 ${
                  indeterminate ? 'w-1/3 animate-pulse' : ''
                }`}
                style={indeterminate ? undefined : { width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 space-y-1 text-[10px] text-neutral-500">
              {queued ? (
                <p>キュー待ちです。前の解析が終わると自動で開始します。</p>
              ) : saving ? (
                <p>結果を保存しています…（{current}/{total} 点処理済み）</p>
              ) : pct === 0 ? (
                <p>フレームを読み込んで準備しています…</p>
              ) : (
                <p>
                  {current} / {total} 点のフレームを解析中
                  {j.current_label && (
                    <>
                      （時刻 <span className="font-medium text-neutral-700">{j.current_label}</span>）
                    </>
                  )}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {elapsed > 0 && (
                  <span className="inline-flex items-center gap-1 tabular-nums text-neutral-400">
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 5v3.5l2.5 1.5" strokeLinecap="round" />
                    </svg>
                    {fmtClock(elapsed)}
                  </span>
                )}
                {j.drone_mode && (
                  <span className="inline-flex items-center rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">
                    ドローン撮影
                  </span>
                )}
                {j.upscale && (
                  <span className="inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700">
                    AIアップスケール
                  </span>
                )}
                {j.tree_id && (
                  <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                    {j.tree_id}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {done.map((j) => (
        <div key={j.job_id} className="rounded-lg border border-neutral-100 p-2.5">
          <div className="flex items-center justify-between text-xs font-medium text-neutral-700">
            <span className="truncate">動画 #{j.video_id} の解析</span>
            <span className="flex items-center gap-1 font-medium text-health-good">
              {CHECK}
              完了
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-health-good/20">
            <div className="h-full w-full rounded-full bg-health-good" />
          </div>
          <p className="mt-1.5 text-[10px] text-neutral-500">
            {j.saved != null ? `${j.saved} 点の観測を保存しました` : '解析が終了しました'}
          </p>
        </div>
      ))}

      {failed.map((j) => (
        <div key={j.job_id} className="rounded-lg border border-neutral-100 p-2.5">
          <div className="flex items-center justify-between text-xs font-medium text-neutral-700">
            <span className="truncate">動画 #{j.video_id} の解析</span>
            <span className="font-medium text-health-danger">エラー</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-health-danger/20">
            <div className="h-full w-full rounded-full bg-health-danger" />
          </div>
          <p className="mt-1.5 break-words text-[10px] text-health-danger">
            {j.error || '解析に失敗しました'}
          </p>
        </div>
      ))}
    </div>
  );
}