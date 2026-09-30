'use client';

/**
 * Circular SVG gauge that displays a health score (0..1) with color coding.
 * Designed for farmer-friendly display: large, clear, color-coded.
 */
export function HealthGauge({
  score,
  label,
  size = 140,
  strokeWidth = 10,
}: {
  score: number;
  label?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const clamped = Math.max(0, Math.min(1, score));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const center = size / 2;

  // Color based on score thresholds
  let color = '#b8433a'; // danger
  if (clamped >= 0.75) color = '#3b8a4a'; // happy
  else if (clamped >= 0.55) color = '#7a9a3a'; // good
  else if (clamped >= 0.35) color = '#c9972e'; // caution

  // Japanese label
  let stateLabel = '要管理';
  if (clamped >= 0.75) stateLabel = '健康';
  else if (clamped >= 0.55) stateLabel = '良好';
  else if (clamped >= 0.35) stateLabel = '注意';

  return (
    <div className="flex w-full max-w-full flex-col items-center gap-1">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="block h-auto w-full max-w-full shrink-0"
        style={{ maxWidth: size }}
        role="img"
        aria-label={`健康スコア: ${clamped.toFixed(2)}`}
      >
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#e8e8e8"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        {/* Score text */}
        <text x={center} y={center - 6} textAnchor="middle" fontSize={size * 0.18} fontWeight="bold" fill="#2b2b2b">
          {(clamped * 100).toFixed(0)}
        </text>
        <text x={center} y={center + 12} textAnchor="middle" fontSize={size * 0.1} fill="#666">
          点
        </text>
      </svg>
      {label && (
        <span className="text-sm font-medium" style={{ color }}>
          {label}
        </span>
      )}
      {!label && (
        <span className="text-sm font-medium" style={{ color }}>
          {stateLabel}
        </span>
      )}
    </div>
  );
}

/**
 * Horizontal bar gauge for a single metric.
 */
export function MetricBar({
  label,
  value,
  max = 1,
  unit = '',
  color,
}: {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  color?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const barColor = color ?? '#3b8a4a';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-neutral-600">{label}</span>
        <span className="font-medium text-neutral-800">
          {typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : value}
          {unit}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-neutral-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

/**
 * Small stat card for dashboard overview.
 */
export function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-bold" style={{ color: color ?? '#2b2b2b' }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-neutral-400">{sub}</div>}
    </div>
  );
}
