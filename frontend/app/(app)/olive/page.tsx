'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, formatTimestamp, Observation, OliveStatus } from '@/lib/api';
import { healthColor, healthJa, StatePill, STATE_ORDER, scoreColor } from '@/components/charts';
import { FarmerHome } from '@/components/FarmerHome';
import { PageHeader } from '@/components/PageHeader';
import ErrorNotice from '@/components/ErrorNotice';
import Link from 'next/link';

function HealthGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score * 100));
  const color = scoreColor(score);
  const zones = [
    { lo: 0, hi: 35, color: '#c25a4a' },
    { lo: 35, hi: 55, color: '#c99a2e' },
    { lo: 55, hi: 75, color: '#84a841' },
    { lo: 75, hi: 100, color: '#4c9a5a' },
  ];
  return (
    <div className="w-full">
      <div className="mb-1.5 flex justify-between text-xs text-neutral-400">
        <span>要管理</span>
        <span>健康</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-neutral-100">
        {/* threshold zones */}
        <div className="absolute inset-y-0 left-0 flex w-full">
          {zones.map((z, i) => (
            <div
              key={i}
              className="h-full"
              style={{ width: `${z.hi - z.lo}%`, background: z.color, opacity: 0.35 }}
            />
          ))}
        </div>
        {/* current-score pointer */}
        <div
          className="absolute top-1/2 -translate-y-1/2"
          style={{ left: `calc(${pct}% - 5px)`, transition: 'left 0.5s ease' }}
        >
          <div className="h-4 w-2.5 rounded-sm border-2 border-white shadow" style={{ background: color }} />
        </div>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="text-sm font-semibold" style={{ color }}>
          スコア {(score * 100).toFixed(1)} / 100
        </span>
      </div>
    </div>
  );
}

export default function OlivePage() {
  const [status, setStatus] = useState<OliveStatus | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, obs] = await Promise.all([
        api.oliveStatus(),
        api.observations().catch(() => []),
      ]);
      setStatus(s);
      setObservations(obs);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'バックエンドに接続できません。');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const current = status?.current_state;
  const total = status?.total_observations ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <PageHeader
        title="オリーブの体調"
        description="解析結果から算出した健康スコアに応じて、オリーブの状態を客観的に表示します。"
      />

      {error && (
        <ErrorNotice message={error} />
      )}

      {status && (
        <>
          {/* main character card */}
          <section className="card mb-6 overflow-hidden">
            {current ? (
              <div className="flex flex-col items-center gap-8 md:flex-row md:gap-12">
                <CharAvatar state={current.label} size={200} />
                <div className="min-w-0 flex-1 text-center md:text-left">
                  <div className="flex items-center justify-center gap-2 md:justify-start">
                    <StatePill label={healthJa(current.label)} color={healthColor(current.label)} />
                    <span className="text-xs text-neutral-400">
                      {status.current_video
                        ? `${status.current_video} @ ${formatTimestamp(status.current_timestamp)}`
                        : ''}
                    </span>
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-900">
                    オリーブちゃん
                  </h2>
                  <p className="mt-2 leading-relaxed text-neutral-600">{current.message}</p>
                  {current.details && (
                    <p className="mt-1 text-sm text-neutral-400">{current.details}</p>
                  )}
                  {current.advice && current.advice.length > 0 && (
                    <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-left">
                      <p className="text-xs font-medium text-neutral-500">次にやるべきこと</p>
                      <ul className="mt-1 space-y-1 text-sm text-neutral-600">
                        {current.advice.map((a, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-6">
                    <HealthGauge score={current.score} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6 py-10 text-center">
                <CharAvatar state="good" size={150} />
                <p className="max-w-md text-sm text-neutral-500">
                  まだ解析データがありません。ダッシュボードから動画を解析すると、ここにオリーブの体調が表示されます。
                </p>
                <Link href="/" className="btn-primary">
                  ダッシュボードへ
                </Link>
              </div>
            )}
          </section>

          {/* metric cards */}
          <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="解析観測点数" value={String(total)} />
            <Metric
              label="健康・良好"
              value={String((status.states.happy || 0) + (status.states.good || 0))}
              sub={`健康 ${status.states.happy || 0} / 良好 ${status.states.good || 0}`}
            />
            <Metric
              label="注意"
              value={String(status.states.caution || 0)}
              sub="水分・葉の状態チェック対象"
              color={healthColor('caution')}
            />
            <Metric
              label="要管理"
              value={String(status.states.danger || 0)}
              sub="早めの対応が必要"
              color={healthColor('danger')}
            />
          </section>

          {/* state breakdown */}
          {total > 0 && (
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STATE_ORDER.map((key) => {
                const info = status.labels[key];
                const count = status.states[key] || 0;
                const pct = (count / total) * 100;
                const color = healthColor(key);
                return (
                  <div key={key} className="card flex items-center gap-4">
                    <CharAvatar state={key} size={56} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium" style={{ color }}>
                        {info.ja}
                      </p>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-xl font-semibold tabular-nums text-neutral-800">{count}</span>
                        <span className="text-xs text-neutral-400">件</span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Farmer dashboard with observation history */}
          <section className="mt-8">
            <FarmerHome
              observations={observations}
              videoCount={0}
              imageCount={0}
            />
          </section>
        </>
      )}
    </div>
  );
}

function CharAvatar({ state, size }: { state: string; size: number }) {
  const name = (['happy', 'good', 'caution', 'danger'] as const).includes(state as any) ? state : 'good';
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/characters/${name}.svg`}
      width={size}
      height={size}
      alt={`オリーブ（${healthJa(name)}）`}
      className="shrink-0 rounded-2xl bg-neutral-50 ring-1 ring-neutral-100"
    />
  );
}

function Metric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card">
      <p className="stat-label">{label}</p>
      <p className="mt-1 stat-value" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="mt-1 text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}
