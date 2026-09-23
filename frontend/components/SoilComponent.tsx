'use client';

import { useEffect, useState } from 'react';
import { api, SoilMoistureData, SoilMoistureInput, SoilStatus } from '@/lib/api';
import { fmtMeasuredAt } from '@/lib/format';

const RISK_COLOR: Record<string, string> = {
  low: '#4c9a5a',
  medium: '#c99a2e',
  high: '#c25a4a',
  dry: '#c25a4a',
  wet: '#3b82c4',
  unknown: '#a0a0a0',
};

function riskColor(risk?: string): string {
  return RISK_COLOR[risk || 'unknown'] || RISK_COLOR.unknown;
}

function fmt(val: number | null | undefined, unit = '', digits = 0, suffix = ''): string {
  if (val == null || Number.isNaN(val)) return '—';
  return `${val.toFixed(digits)}${unit}${suffix}`;
}

export function SoilDisplay({
  source,
  soil,
  compact,
}: {
  source?: string;
  soil?: SoilMoistureData | null;
  compact?: boolean;
}) {
  if (!soil) {
    return (
      <p className="text-xs text-neutral-400">土壌水分データなし</p>
    );
  }
  const h = soil.health;
  const risk = h?.risk;
  const color = riskColor(risk);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span className="text-xs text-neutral-600" style={{ color }}>
          土壌水分 {fmt(soil.sensor1_moisture_percent, '%')}
        </span>
        <span className="text-[11px] text-neutral-400">
          {source === 'api' ? '自動' : source === 'manual' ? '手動入力' : ''}
        </span>
        {soil.measured_at && (
          <span className="text-[11px] text-neutral-400">{fmtMeasuredAt(soil.measured_at)}ごろ</span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3 text-sm" style={{ borderColor: `${color}33`, background: `${color}0d` }}>
      <div className="flex items-center justify-between">
        <p className="font-medium" style={{ color }}>
          {h?.message || '土壌水分'}
        </p>
        <span className="text-[11px] text-neutral-400">
          {source === 'api' ? '自動取得' : source === 'manual' ? '手動入力' : '未設定'}
          {soil.measured_at && ` · ${fmtMeasuredAt(soil.measured_at)}ごろ`}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-white/70 px-2.5 py-1.5">
          <dt className="text-[11px] text-neutral-400">センサー1</dt>
          <dd className="font-medium tabular-nums text-neutral-800">{fmt(soil.sensor1_moisture_percent, '%')}</dd>
        </div>
        <div className="rounded-md bg-white/70 px-2.5 py-1.5">
          <dt className="text-[11px] text-neutral-400">センサー2</dt>
          <dd className="font-medium tabular-nums text-neutral-800">{fmt(soil.sensor2_moisture_percent, '%')}</dd>
        </div>
        <div className="rounded-md bg-white/70 px-2.5 py-1.5">
          <dt className="text-[11px] text-neutral-400">気温</dt>
          <dd className="font-medium tabular-nums text-neutral-800">{fmt(soil.temperature, '°C', 1)}</dd>
        </div>
        <div className="rounded-md bg-white/70 px-2.5 py-1.5">
          <dt className="text-[11px] text-neutral-400">湿度</dt>
          <dd className="font-medium tabular-nums text-neutral-800">{fmt(soil.humidity, '%')}</dd>
        </div>
      </div>
      {h && h.score != null && h.weight > 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          評価スコア {h.score.toFixed(3)}（重み {h.weight.toFixed(2)}）
        </p>
      )}
    </div>
  );
}

export function SoilInputPanel({
  onChange,
}: {
  onChange: (v: SoilMoistureInput | undefined) => void;
}) {
  const [status, setStatus] = useState<SoilStatus | null>(null);
  const [mode, setMode] = useState<'auto' | 'manual'>('manual');
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [temp, setTemp] = useState('');
  const [hum, setHum] = useState('');

  const autoConfigured = !!status?.source && status.source !== 'none';

  useEffect(() => {
    api.soilStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (autoConfigured) setMode('auto');
  }, [autoConfigured]);

  useEffect(() => {
    if (mode === 'auto' || !onChange) return;
    const has = s1.trim() || s2.trim() || temp.trim() || hum.trim();
    onChange(
      has
        ? {
            sensor1_moisture_percent: s1.trim() ? parseFloat(s1) : null,
            sensor2_moisture_percent: s2.trim() ? parseFloat(s2) : null,
            temperature: temp.trim() ? parseFloat(temp) : null,
            humidity: hum.trim() ? parseFloat(hum) : null,
          }
        : undefined
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, s1, s2, temp, hum, autoConfigured]);

  return (
    <div className="rounded-lg bg-neutral-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-700">土壌水分・環境情報</p>
        {status && (
          <span className="text-[11px] text-neutral-400">
            {status.health.message || '—'}
          </span>
        )}
      </div>

      {(mode === 'auto' && status) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="badge bg-health-good/10 text-health-good">自動取得中</span>
            <span className="text-xs text-neutral-500">
              センサー1 {fmt(status.soil_moisture.sensor1_moisture_percent, '%')} ／ センサー2{' '}
              {fmt(status.soil_moisture.sensor2_moisture_percent, '%')}
            </span>
          </div>
          <button type="button" onClick={() => setMode('manual')} className="text-xs text-olive-700 underline">
            手動入力に切替
          </button>
        </div>
      )}

      {(mode === 'manual' || (mode === 'auto' && !status)) && (
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SoilField label="センサー1 (%)" value={s1} onChange={setS1} placeholder="例: 32" />
            <SoilField label="センサー2 (%)" value={s2} onChange={setS2} placeholder="例: 28" />
            <SoilField label="気温 (°C)" value={temp} onChange={setTemp} placeholder="例: 26.5" />
            <SoilField label="湿度 (%)" value={hum} onChange={setHum} placeholder="例: 55" />
          </div>
          {autoConfigured && (
            <button type="button" onClick={() => setMode('auto')} className="mt-2 text-xs text-olive-700 underline">
              自動取得を使用
            </button>
          )}
          <p className="mt-1.5 text-[11px] text-neutral-400">
            空欄なら土壌水分なしで解析します（設定ファイルがあれば自動取得を優先）。
          </p>
        </div>
      )}
    </div>
  );
}

function SoilField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-neutral-400">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input px-2.5 py-1.5 text-sm"
      />
    </div>
  );
}
