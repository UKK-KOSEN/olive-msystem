'use client';

import { Observation } from '@/lib/api';
import { HealthGauge, StatCard } from './HealthGauge';
import { healthJa, healthColor } from './charts';
import { IconOlive } from './icons';

/**
 * Farmer-friendly home dashboard showing current status and recent observations.
 */
export function FarmerHome({
  observations,
  videoCount,
  imageCount,
}: {
  observations: Observation[];
  videoCount: number;
  imageCount: number;
}) {
  // The API returns newest-first, so sort ascending for latest/trend logic.
  const sorted = [...observations].sort((a, b) => a.id - b.id);
  // Compute stats
  const totalObs = sorted.length;
  const scores = sorted
    .map((o) => o.health_state?.score)
    .filter((s): s is number => s != null);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const latestState = latest?.health_state;

  // Health distribution
  const dist = { happy: 0, good: 0, caution: 0, danger: 0 };
  sorted.forEach((o) => {
    const l = o.health_state?.label;
    if (l && l in dist) dist[l as keyof typeof dist]++;
  });

  // Trend direction (compare last 3 scores)
  const recentScores = scores.slice(-3);
  let trend = '—';
  let trendColor = '#999';
  if (recentScores.length >= 2) {
    const diff = recentScores[recentScores.length - 1] - recentScores[0];
    if (diff > 0.05) {
      trend = '↑ 改善傾向';
      trendColor = '#4c9a5a';
    } else if (diff < -0.05) {
      trend = '↓ 要注意';
      trendColor = '#c25a4a';
    } else {
      trend = '→ 安定';
      trendColor = '#84a841';
    }
  }

  return (
    <div className="space-y-6">
      {/* Current status card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-500 mb-4">現在のステータス</h2>
        <div className="flex items-center gap-6">
          {latestState && (
            <div className="w-[124px] shrink-0">
              <HealthGauge
                score={latestState.score ?? 0}
                size={120}
                strokeWidth={9}
                label="現在のスコア"
              />
            </div>
          )}
          <div className="flex-1">
            <div className="text-lg font-bold" style={{ color: healthColor(latestState?.label ?? '') }}>
              {latestState ? healthJa(latestState.label) : 'データなし'}
            </div>
            <div className="text-sm text-neutral-600 mt-1">
              {latestState?.message ?? '解析データがまだありません。'}
            </div>
            <div className="mt-2 text-xs" style={{ color: trendColor }}>
              {trend}
            </div>
            {latest && (
              <div className="mt-1 text-xs text-neutral-400">
                最終解析: {latest.observed_at ? new Date(latest.observed_at).toLocaleString('ja-JP') : '—'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="解析回数" value={totalObs} sub="件" color="#2b2b2b" />
        <StatCard label="平均スコア" value={totalObs > 0 ? (avgScore * 100).toFixed(0) : '—'} sub="点" color={healthColor(
          avgScore >= 0.75 ? 'happy' : avgScore >= 0.55 ? 'good' : avgScore >= 0.35 ? 'caution' : 'danger'
        )} />
        <StatCard label="動画" value={videoCount} sub="本" color="#5b8def" />
        <StatCard label="画像" value={imageCount} sub="枚" color="#7b68c9" />
      </div>

      {/* Health distribution */}
      {totalObs > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-500 mb-3">健康状態の分布</h2>
          <div className="flex gap-1 h-4 rounded-full overflow-hidden">
            {(['happy', 'good', 'caution', 'danger'] as const).map((key) => {
              const count = dist[key];
              const pct = totalObs > 0 ? (count / totalObs) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={key}
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: healthColor(key),
                  }}
                  title={`${healthJa(key)}: ${count}件 (${pct.toFixed(0)}%)`}
                />
              ) : null;
            })}
          </div>
          <div className="flex gap-4 mt-2 text-xs">
            {(['happy', 'good', 'caution', 'danger'] as const).map((key) => (
              <div key={key} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: healthColor(key) }} />
                <span className="text-neutral-600">{healthJa(key)}: {dist[key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent observations */}
      {sorted.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-500 mb-3">最近の解析結果</h2>
          <div className="space-y-2">
            {sorted.slice(-5).reverse().map((o) => {
              const hs = o.health_state;
              const color = healthColor(hs?.label ?? '');
              return (
                <div key={o.id} className="flex items-center gap-3 rounded-lg border border-neutral-100 p-3 hover:bg-neutral-50 transition-colors">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-800 truncate">
                      {o.filename ?? `観測 #${o.id}`}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {o.observed_at ? new Date(o.observed_at).toLocaleString('ja-JP') : ''}
                      {o.timestamp_sec != null && o.timestamp_sec > 0 && ` · ${o.timestamp_sec.toFixed(1)}s`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold" style={{ color }}>
                      {hs?.score != null ? (hs.score * 100).toFixed(0) : '—'}
                    </div>
                    <div className="text-xs" style={{ color }}>
                      {hs ? healthJa(hs.label) : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No data state */}
      {totalObs === 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-neutral-400 grid justify-items-center"><IconOlive size={40} /></div>
          <div className="text-neutral-600">
            まだ解析データがありません。
          </div>
          <div className="text-sm text-neutral-400 mt-1">
            画像や動画をアップロードして解析を開始しましょう。
          </div>
        </div>
      )}
    </div>
  );
}
