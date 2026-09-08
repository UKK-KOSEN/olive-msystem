'use client';

import { useId, useMemo, useRef, useState } from 'react';
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
      return '#4c9a5a';
    case 'good':
      return '#84a841';
    case 'caution':
      return '#c99a2e';
    case 'danger':
      return '#c25a4a';
    default:
      return '#a0a0a0';
  }
}

function obsScore(o: Observation): number | null {
  if (o.health_state?.score != null) return o.health_state.score;
  const stress = o.result?.analysis_details?.stress;
  if (stress?.overall_health_score != null) return stress.overall_health_score;
  if (o.overall_health_score != null) return o.overall_health_score;
  return null;
}

export function StatePill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex w-14 items-center justify-center rounded-md px-2 py-1 text-xs font-medium"
      style={{ background: `${color}14`, color }}
    >
      {label}
    </span>
  );
}

/** State ranges shown in the legend; kept quiet and small. */
const ZONES: { label: string; color: string; lo: number; hi: number }[] = [
  { label: '健康', color: '#4c9a5a', lo: 0.75, hi: 1 },
  { label: '良好', color: '#84a841', lo: 0.55, hi: 0.75 },
  { label: '注意', color: '#c99a2e', lo: 0.35, hi: 0.55 },
  { label: '要管理', color: '#c25a4a', lo: 0, hi: 0.35 },
];

type Pt = { score: number; obs: Observation; t: number; x: number; y: number };

/**
 * Clean, minimal line chart of the health score (0..100) over time.
 * - Single smooth curve with a soft area fill; no noisy threshold bands
 * - Dots colored by state, latest value emphasised with a pill badge
 * - Light gridlines, hover crosshair + tooltip, quiet legend
 */
export function TrendChart({ obs, width = 720, height = 300, minWidth = 560 }: { obs: Observation[]; width?: number; height?: number; minWidth?: number }) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pad = { left: 44, right: 20, top: 24, bottom: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const pts = useMemo(() => {
    return obs
      .map((o) => ({ score: obsScore(o), obs: o, t: parseDate(o.observed_at) }))
      .filter((p): p is { score: number; obs: Observation; t: number } => p.score != null)
      .sort((a, b) => a.t - b.t);
  }, [obs]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, tMin, span, innerW, innerH, isEmpty]);

  const linePath = straightPath(ptsF);
  const areaPath =
    ptsF.length > 1
      ? linePath + ` L ${ptsF[ptsF.length - 1].x} ${pad.top + innerH} L ${ptsF[0].x} ${pad.top + innerH} Z`
      : '';

  // up to 6 x ticks, with collision avoidance so labels never overlap
  const xTicks = useMemo(() => {
    if (ptsF.length === 0) return [];
    const maxN = Math.max(2, Math.min(6, Math.floor(innerW / 96)));
    const minSep = 84;
    const out: Pt[] = [];
    for (let i = 0; i < maxN; i++) {
      const idx = Math.round((i / (maxN - 1 || 1)) * (ptsF.length - 1));
      const c = ptsF[idx];
      if (out.length === 0 || c.x - out[out.length - 1].x >= minSep) out.push(c);
    }
    const lastP = ptsF[ptsF.length - 1];
    if (out.length === 0) out.push(lastP);
    else if (lastP.x - out[out.length - 1].x < minSep) out[out.length - 1] = lastP;
    return out;
  }, [ptsF, innerW]);

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vx = (e.clientX - rect.left) * (width / rect.width);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < ptsF.length; i++) {
      const d = Math.abs(ptsF[i].x - vx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  const tooltip = useMemo(() => {
    if (hoverIdx == null || ptsF.length === 0) return null;
    const p = ptsF[hoverIdx];
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return null;
    const rect = svg.getBoundingClientRect();
    const sx = rect.width / width;
    const sy = rect.height / height;
    const TW = 230;
    const TH = 104;
    let left = p.x * sx + 14;
    if (left + TW > wrap.clientWidth - 8) left = p.x * sx - TW - 14;
    if (left < 8) left = 8;
    let top = p.y * sy - TH / 2;
    if (top < 8) top = p.y * sy + 14;
    if (top + TH > wrap.clientHeight - 8) top = Math.max(8, wrap.clientHeight - TH - 8);
    return { left, top, p };
  }, [hoverIdx, ptsF, width, height]);

  if (isEmpty) {
    return <p className="py-6 text-center text-sm text-neutral-400">スコアデータがありません。</p>;
  }

  const last = ptsF[ptsF.length - 1];
  const lastColor = healthColor(last.obs.health_state?.label ?? '');
  // draw individual dots only when few observations, otherwise keep just the line
  const showDots = ptsF.length <= 12;

  // latest pill, clamped inside the plot area
  const pill = (() => {
    const w = 58;
    const h = 22;
    let bx = Math.max(pad.left + w / 2 + 4, Math.min(width - pad.right - w / 2 - 4, last.x));
    let by = last.y - h - 14;
    if (by < pad.top + 2) by = last.y + 14;
    return { bx, by, w, h };
  })();

  return (
    <div className="w-full">
      <div ref={wrapRef} className="relative w-full overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth }}
          className="w-full"
          role="img"
          aria-label="体調スコアの時系列推移"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a4a4a" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#4a4a4a" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* state boundary guides (35/55/75) */}
          {[0.35, 0.55, 0.75].map((v) => {
            const zone = ZONES.find((z) => v >= z.lo && v < z.hi);
            const y = yFor(v);
            return (
              <line key={v} x1={pad.left} y1={y} x2={width - pad.right} y2={y}
                stroke={zone ? `${zone.color}55` : '#ccc'} strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
            );
          })}

          {/* horizontal gridlines + y labels (percent) */}
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
                <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize="12" fill="#6b746c" fontWeight="500">
                  {Math.round(v * 100)}
                </text>
              </g>
            );
          })}

          {/* vertical grid + x labels */}
          {xTicks.map((p, i) => {
            const d = new Date(p.t);
            const label =
              spanHours >= 26
                ? `${d.getMonth() + 1}/${d.getDate()}`
                : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const showFull =
              spanHours >= 26 && i === xTicks.length - 1
                ? `${label} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                : label;
            return (
              <g key={i}>
                <line x1={p.x} y1={pad.top} x2={p.x} y2={pad.top + innerH} stroke="#eef0ea" strokeWidth="1" />
                <text x={p.x} y={height - 7} textAnchor="middle" fontSize="11" fill="#6b746c" fontWeight="500">
                  {showFull}
                </text>
              </g>
            );
          })}

          {/* area under curve */}
          {areaPath && <path d={areaPath} fill={`url(#grad-${gradId})`} />}

          {/* line */}
          {ptsF.length > 1 && (
            <path d={linePath} fill="none" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* hover crosshair */}
          {hoverIdx != null && (
            <line
              x1={ptsF[hoverIdx].x}
              y1={pad.top}
              x2={ptsF[hoverIdx].x}
              y2={pad.top + innerH}
              stroke="#c3c9bf"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {/* points — state-colored and clearly visible */}
          {ptsF.map((p, i) => {
            const isLast = i === ptsF.length - 1;
            const color = healthColor(p.obs.health_state?.label ?? '');
            if (isLast) {
              return (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={hoverIdx === i ? 12 : 10} fill={color} opacity="0.2" />
                  <circle cx={p.x} cy={p.y} r={7} fill={color} stroke="#fff" strokeWidth="2.5" />
                </g>
              );
            }
            if (!showDots) return null;
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={hoverIdx === i ? 6 : 4.5}
                fill={color}
                stroke="#fff"
                strokeWidth="2"
                style={{ transition: 'r 0.12s ease' }}
              />
            );
          })}

          {/* latest value pill */}
          <rect x={pill.bx - pill.w / 2} y={pill.by} width={pill.w} height={pill.h} rx={11} fill="#ffffff" stroke={lastColor} strokeWidth="2" />
          <circle cx={pill.bx - pill.w / 2 + 12} cy={pill.by + pill.h / 2} r={4} fill={lastColor} />
          <text
            x={pill.bx - pill.w / 2 + 17}
            y={pill.by + 15.5}
            fontSize="12.5"
            fontWeight="800"
            fill={lastColor}
          >
            {(last.score * 100).toFixed(0)}点
          </text>
        </svg>

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-neutral-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm"
            style={{ left: tooltip.left, top: tooltip.top, width: 230 }}
          >
            <div className="text-[11px] text-neutral-400">
              {new Date(tooltip.p.t).toLocaleString('ja-JP', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: healthColor(tooltip.p.obs.health_state?.label ?? '') }}>
                {tooltip.p.score.toFixed(2)} 点
              </span>
              <StatePill label={healthJa(tooltip.p.obs.health_state?.label ?? '')} color={healthColor(tooltip.p.obs.health_state?.label ?? '')} />
            </div>
            <div className="mt-1 truncate text-[11px] text-neutral-500">
              {tooltip.p.obs.filename || `観測 #${tooltip.p.obs.id}`}
            </div>
          </div>
        )}
      </div>

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {ZONES.map((z) => (
          <span key={z.label} className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span className="h-2 w-2 rounded-full" style={{ background: z.color }} />
            {z.label}
            <span className="tabular-nums text-neutral-400">
              {z.lo === 0 ? '〜35' : z.hi === 1 ? '75〜' : `${Math.round(z.lo * 100)}〜${Math.round(z.hi * 100)}`}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Straight polyline through the points — keeps the chart honest and calm.
 */
function straightPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

function parseDate(iso?: string | null): number {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
}