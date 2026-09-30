'use client';

import { useMemo, useRef, useState } from 'react';
import { Observation } from '@/lib/api';

export function healthJa(label: string): string {
  switch (label) {
    case 'happy':
      return '健康';
    case 'good':
      return '良好';
    case 'caution':
      return '注意';
    case 'danger':
      return '要管理';
    default:
      return label;
  }
}

export function healthColor(label: string): string {
  switch (label) {
    case 'happy':
      return '#3b8a4a';
    case 'good':
      return '#7a9a3a';
    case 'caution':
      return '#c9972e';
    case 'danger':
      return '#b8433a';
    default:
      return '#a0a0a0';
  }
}

export const STATE_ORDER = ['happy', 'good', 'caution', 'danger'] as const;

export type HealthState = (typeof STATE_ORDER)[number];

/** Map a health label to its display order index. */
export function stateIndex(label: string): number {
  return STATE_ORDER.indexOf(label as HealthState);
}

export function obsScore(o: Observation): number | null {
  if (o.health_state?.score != null) return o.health_state.score;
  const stress = o.result?.analysis_details?.stress;
  if (stress?.overall_health_score != null) return stress.overall_health_score;
  if (o.overall_health_score != null) return o.overall_health_score;
  return null;
}

/** Derive a health label for an observation: explicit label, else score thresholds. */
export function stateOf(o: Observation): string {
  if (o.health_state?.label) return o.health_state.label;
  return stateOfScore(obsScore(o));
}

/** Derive a health label from a numeric score (mirrors backend thresholds). */
export function stateOfScore(score: number | null | undefined): HealthState {
  if (score == null) return 'good';
  if (score >= 0.75) return 'happy';
  if (score >= 0.55) return 'good';
  if (score >= 0.35) return 'caution';
  return 'danger';
}

/** Color for a numeric health score. */
export function scoreColor(score: number | null | undefined): string {
  return healthColor(stateOfScore(score));
}

/** Japanese label for a numeric health score. */
export function scoreLabel(score: number | null | undefined): string {
  return healthJa(stateOfScore(score));
}

export function StatePill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex min-w-14 items-center justify-center rounded-md px-2 py-1 text-xs font-medium"
      style={{ background: `${color}14`, color }}
    >
      {label}
    </span>
  );
}

const ZONES: { label: string; color: string; lo: number; hi: number }[] = [
  { label: '健康', color: '#3b8a4a', lo: 0.75, hi: 1 },
  { label: '良好', color: '#7a9a3a', lo: 0.55, hi: 0.75 },
  { label: '注意', color: '#c9972e', lo: 0.35, hi: 0.55 },
  { label: '要管理', color: '#b8433a', lo: 0, hi: 0.35 },
];

type Pt = { score: number; obs: Observation; t: number; x: number; y: number };
type RenderPt = Pt & { n?: number };

/**
 * Simple health-score line chart. With few observations it draws a straight
 * polyline through every point; once the data gets dense (many observations)
 * it buckets the points into ~equal time slices, plots the AVERAGE score per
 * slice as a smooth curve so the trend stays readable instead of a noisy tangle.
 */
export function TrendChart({
  obs,
  width = 720,
  height = 300,
  minWidth = 0,
  showSummary = true,
}: {
  obs: Observation[];
  width?: number;
  height?: number;
  minWidth?: number;
  showSummary?: boolean;
}) {
  const pad = { left: 48, right: 20, top: 24, bottom: 38 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const pts = useMemo(
    () =>
      obs
        .map((o) => ({ score: obsScore(o), obs: o, t: parseDate(o.observed_at) }))
        .filter((p): p is { score: number; obs: Observation; t: number } => p.score != null)
        .sort((a, b) => a.t - b.t),
    [obs],
  );

  const isEmpty = pts.length === 0;
  const tMin = isEmpty ? 0 : pts[0].t;
  const tMax = isEmpty ? 1 : pts[pts.length - 1].t;
  const span = Math.max(1, tMax - tMin);
  const spanHours = span / 3600000;

  const xFor = (t: number) => pad.left + ((t - tMin) / span) * innerW;
  const yFor = (s: number) => pad.top + innerH - Math.max(0, Math.min(1, s)) * innerH;

  const ptsF = useMemo<Pt[]>(() => {
    if (isEmpty) return [];
    return pts.map((p) => ({ ...p, x: xFor(p.t), y: yFor(p.score) }));
  }, [pts, tMin, span, innerW, innerH, isEmpty]);

  // Dense data -> bucket into ~equal time slices and use the slice AVERAGE,
  // so overlapping observations collapse into a smooth readable curve.
  const MAX_RAW_POINTS = 60;
  const renderPts = useMemo<RenderPt[]>(() => {
    if (ptsF.length <= MAX_RAW_POINTS) return ptsF;
    const buckets = Math.max(8, Math.min(MAX_RAW_POINTS, Math.round(innerW / 14)));
    const seg = ptsF.length / buckets;
    const out: RenderPt[] = [];
    for (let i = 0; i < buckets; i++) {
      const a = Math.floor(i * seg);
      const b = Math.max(a + 1, Math.floor((i + 1) * seg));
      const slice = ptsF.slice(a, b);
      const x = slice.reduce((s, p) => s + p.x, 0) / slice.length;
      const y = slice.reduce((s, p) => s + p.y, 0) / slice.length;
      let rep = slice[0];
      let bestD = Infinity;
      for (const p of slice) {
        const d = Math.abs(p.x - x);
        if (d < bestD) {
          bestD = d;
          rep = p;
        }
      }
      out.push({ score: y, obs: rep.obs, t: rep.t, x, y, n: slice.length });
    }
    // always end the line on the REAL latest observation (not a bucket mean)
    out[out.length - 1] = ptsF[ptsF.length - 1];
    return out;
  }, [ptsF, innerW]);

  const isAveraged = ptsF.length > MAX_RAW_POINTS;
  const linePath =
    renderPts.length > 1
      ? isAveraged
        ? smoothPath(renderPts)
        : renderPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      : '';

  const xTicks = useMemo<Pt[]>(() => {
    if (renderPts.length === 0) return [];
    const maxN = Math.max(2, Math.min(4, Math.floor(innerW / 120)));
    const indices = Array.from({ length: maxN }, (_, i) =>
      Math.round((i / (maxN - 1 || 1)) * (renderPts.length - 1)),
    );
    const unique = [...new Set(indices)];
    if (unique[unique.length - 1] !== renderPts.length - 1) unique[unique.length - 1] = renderPts.length - 1;
    return unique.map((index) => renderPts[index]);
  }, [renderPts, innerW]);

  if (isEmpty) {
    return <p className="py-6 text-center text-sm text-neutral-400">スコアデータがありません。</p>;
  }

  const first = ptsF[0];
  const last = ptsF[ptsF.length - 1];
  const lastColor = healthColor(last.obs.health_state?.label ?? '');
  const change = last.score - first.score;
  const changeLabel = `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}点`;
  const hover = hoverIdx != null ? renderPts[hoverIdx] : null;

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg || renderPts.length === 0) {
      setHoverIdx(null);
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vx = (e.clientX - rect.left) * (width / rect.width);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < renderPts.length; i++) {
      const d = Math.abs(renderPts[i].x - vx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  return (
    <div className="w-full">
      {showSummary && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-neutral-50 p-3">
          <div>
            <p className="label">最新スコア</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xl font-bold tabular-nums" style={{ color: lastColor }}>
                {(last.score * 100).toFixed(0)}点
              </span>
              <StatePill label={healthJa(last.obs.health_state?.label ?? '')} color={lastColor} />
            </div>
          </div>
          <div className="text-right">
            <p className="label">前回から</p>
            <p
              className="mt-1 text-sm font-bold tabular-nums"
              style={{ color: change >= 0 ? '#3b8a4a' : '#b8433a' }}
            >
              {changeLabel}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-400">
  観測 {ptsF.length}件{isAveraged ? `（${renderPts.length}区間の平均を表示）` : ''}
</p>
          </div>
        </div>
      )}

      <div className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: minWidth || undefined }}
          className="block h-auto w-full"
          role="img"
          aria-label="体調スコアの時系列推移"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((v) => {
            const y = yFor(v);
            const isBase = v === 0;
            return (
              <g key={v}>
                <line
                  x1={pad.left}
                  y1={y}
                  x2={width - pad.right}
                  y2={y}
                  stroke={isBase ? '#d5d9d0' : '#e9ece4'}
                  strokeWidth={isBase ? 1.5 : 1}
                />
                <text x={pad.left - 9} y={y + 4} textAnchor="end" fontSize="12" fill="#6b746c" fontWeight="600">
                  {Math.round(v * 100)}%
                </text>
              </g>
            );
          })}

          {xTicks.map((p, i) => {
            const d = new Date(p.t);
            const label =
              spanHours >= 24 * 365
                ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
                : spanHours >= 24
                  ? `${d.getMonth() + 1}/${d.getDate()}`
                  : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            return (
              <g key={i}>
                <text x={p.x} y={height - 9} textAnchor="middle" fontSize="11" fill="#6b746c" fontWeight="600">
                  {label}
                </text>
              </g>
            );
          })}

          {renderPts.length > 1 && linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#2b2b2b"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {isAveraged ? (
            <>
              {renderPts[0] && (
                <circle
                  cx={renderPts[0].x}
                  cy={renderPts[0].y}
                  r={4}
                  fill={healthColor(renderPts[0].obs.health_state?.label ?? '')}
                  stroke="#fff"
                  strokeWidth="1.5"
                />
              )}
              <circle cx={last.x} cy={last.y} r={6} fill={lastColor} stroke="#fff" strokeWidth="2.5" />
              {hoverIdx != null && renderPts[hoverIdx] && (
                <circle
                  cx={renderPts[hoverIdx].x}
                  cy={renderPts[hoverIdx].y}
                  r={7}
                  fill="none"
                  stroke="#2b2b2b"
                  strokeWidth="1.5"
                />
              )}
            </>
          ) : (
            renderPts.map((p, i) => {
              const isLast = i === renderPts.length - 1;
              const color = healthColor(p.obs.health_state?.label ?? '');
              return (
                <g key={i}>
                  <title>
                    {new Date(p.t).toLocaleString('ja-JP', {
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {'\n'}
                    {(p.score * 100).toFixed(1)}点（{healthJa(p.obs.health_state?.label ?? '')}）
                  </title>
                  {isLast ? (
                    <>
                      <circle cx={p.x} cy={p.y} r={hoverIdx === i ? 12 : 9} fill={color} opacity="0.18" />
                      <circle cx={p.x} cy={p.y} r={6} fill={color} stroke="#fff" strokeWidth="2.5" />
                    </>
                  ) : (
                    <circle cx={p.x} cy={p.y} r={hoverIdx === i ? 6 : 4} fill={color} stroke="#fff" strokeWidth="2" />
                  )}
                </g>
              );
            })
          )}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-lg border border-neutral-200 bg-white/95 px-3 py-2 shadow-lg"
            style={{
              left: `${(hover.x / width) * 100}%`,
              top: `${(hover.y / height) * 100}%`,
              transform: hover.y > height * 0.35 ? 'translate(-50%, calc(-100% - 12px))' : 'translate(-50%, 12px)',
            }}
          >
            <div className="text-[11px] text-neutral-400">
              {new Date(hover.t).toLocaleString('ja-JP', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: healthColor(hover.obs.health_state?.label ?? '') }}
              >
                {(hover.score * 100).toFixed(1)}点
              </span>
              <StatePill
                label={healthJa(hover.obs.health_state?.label ?? '')}
                color={healthColor(hover.obs.health_state?.label ?? '')}
              />
            </div>
            <div className="mt-1 truncate text-[11px] text-neutral-500">
              {hover.obs.filename || `観測 #${hover.obs.id}`}
            </div>
            {isAveraged && hover.n != null && hover.n > 1 && (
              <div className="mt-1 text-[10px] text-neutral-400">この区間 {hover.n} 件の平均です</div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ZONES.map((z) => (
          <div key={z.label} className="rounded-md border border-neutral-100 bg-neutral-50/70 px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: z.color }} />
              <span className="text-[11px] font-semibold text-neutral-600">{z.label}</span>
            </div>
            <div className="mt-1 text-[10px] tabular-nums text-neutral-400">
              {z.lo === 0 ? '0〜35' : z.hi === 1 ? '75〜100' : `${Math.round(z.lo * 100)}〜${Math.round(z.hi * 100)}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseDate(iso?: string | null): number {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
}

/** Catmull-Rom -> cubic bezier smoothing through the given points. */
function smoothPath(points: RenderPt[]): string {
  if (points.length === 0) return '';
  if (points.length < 3) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }
  const parts: string[] = [];
  points.forEach((p, i) => {
    if (i === 0) {
      parts.push(`M ${p.x} ${p.y}`);
      return;
    }
    const p0 = points[Math.max(0, i - 1)];
    const p2 = points[Math.min(points.length - 1, i + 1)];
    const k = (p2.x - p0.x) / 6;
    const cp1x = p.x - k;
    const cp1y = p.y - (p2.y - p0.y) / 6;
    const cp2x = p.x + k;
    const cp2y = p.y + (p2.y - p0.y) / 6;
    parts.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p.x} ${p.y}`);
  });
  return parts.join(' ');
}