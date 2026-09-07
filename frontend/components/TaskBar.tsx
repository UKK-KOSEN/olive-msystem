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
}

export default function TaskBar() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);

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
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (jobs.length === 0) return null;

  const active = jobs.filter((j) => j.status === 'processing' || j.status === 'queued');
  const done = jobs.filter((j) => j.status === 'done');
  const failed = jobs.filter((j) => j.status === 'error');

  const badge =
    active.length > 0
      ? { cls: 'bg-olive-50 text-olive-800', text: `実行中 ${active.length} 件` }
      : failed.length > 0
        ? { cls: 'bg-neutral-100 text-neutral-700', text: `${failed.length} 件 エラー` }
        : { cls: 'bg-neutral-100 text-neutral-700', text: '解析完了' };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2.5 rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-neutral-800">解析タスク</p>
        <span className={`badge ${badge.cls}`}>{badge.text}</span>
      </div>

      {active.map((j) => {
        const pct = Math.max(0, Math.min(100, Math.round(j.progress * 100)));
        const indeterminate = j.status === 'queued' || pct === 0;
        return (
          <div key={j.job_id} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span className="truncate">動画 #{j.video_id} の解析</span>
              <span className="tabular-nums text-neutral-600">
                {indeterminate ? '待機中…' : `${pct}%`}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full bg-olive-700 transition-[width] duration-700 ${
                  indeterminate ? 'w-1/3 animate-pulse' : ''
                }`}
                style={indeterminate ? undefined : { width: `${pct}%` }}
              />
            </div>
            <p className="text-[10px] text-neutral-400">
              {j.status === 'queued' ? 'キュー待ち' : '処理中…'}
            </p>
          </div>
        );
      })}

      {done.map((j) => (
        <div key={j.job_id} className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="truncate">動画 #{j.video_id} の解析</span>
            <span className="flex items-center gap-1 font-medium text-health-good">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              完了
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-health-good/20">
            <div className="h-full w-full rounded-full bg-health-good" />
          </div>
          <p className="text-[10px] text-neutral-400">
            {j.saved != null ? `${j.saved} 点の観測を保存しました` : '解析が終了しました'}
          </p>
        </div>
      ))}

      {failed.map((j) => (
        <div key={j.job_id} className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="truncate">動画 #{j.video_id} の解析</span>
            <span className="font-medium text-health-danger">エラー</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-health-danger/20">
            <div className="h-full w-full rounded-full bg-health-danger" />
          </div>
          <p className="truncate text-[10px] text-health-danger">{j.error || '解析に失敗しました'}</p>
        </div>
      ))}
    </div>
  );
}