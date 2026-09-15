'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  AdminStats,
  FarmerRecord,
  HealthThresholds,
  ImageAsset,
  Observation,
  Video,
  SiteSettings,
  SensorAlertEvent,
  SensorAlertsStatus,
  formatDuration,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSite } from '@/lib/site';
import { healthJa, healthColor, TrendChart } from '@/components/charts';
import { IconOlive } from '@/components/icons';
import ErrorNotice from '@/components/ErrorNotice';
import VideoPreview from '@/components/VideoPreview';

function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

const HEALTH_ORDER = ['happy', 'good', 'caution', 'danger'] as const;

function farmerLabel(f: { username: string; display_name?: string | null; farm_name?: string | null }): string {
  if (f.farm_name) return f.farm_name;
  if (f.display_name) return f.display_name;
  return f.username;
}

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const siteCtx = useSite();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [obs, setObs] = useState<Observation[]>([]);
const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    const [s, v, i, o] = await Promise.all([
      api.adminStats().catch((e) => {
        setLoadError((prev) => prev ?? (e?.message || 'データの取得に失敗しました'));
        return null;
      }),
      api.videos().catch(() => [] as Video[]),
      api.images().catch(() => [] as ImageAsset[]),
      api.observations().catch(() => [] as Observation[]),
    ]);
    setStats(s);
    setVideos(v);
    setImages(i);
    setObs(o);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setMessage({ kind, text });
    setTimeout(() => setMessage(null), 4000);
  };

  if (user && user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <div className="card text-sm text-health-danger">
          このページは管理者のみアクセスできます。
        </div>
      </div>
    );
  }

if (!stats) {
    if (loadError) {
      return (
        <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
          <div className="flex min-h-[40vh] items-center justify-center">
            <ErrorNotice message={loadError} onRetry={loadAll} className="w-full max-w-md" />
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <p className="text-sm text-neutral-400">読み込み中…</p>
      </div>
    );
  }

  const db = stats.db;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => router.back()}
            className="btn-ghost btn-sm"
            title="前のページへ戻る"
          >
            ← 戻る
          </button>
          <Link href="/" className="btn-ghost btn-sm">
            ユーザーUIへ
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">管理</h1>
        <p className="mt-1 text-sm text-neutral-500">
          システム設定・土壌水分連携・データ管理をまとめて行います。
        </p>
      </header>

      {message && (
        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            message.kind === 'ok'
              ? 'bg-health-good/10 text-health-good'
              : 'bg-health-danger/10 text-health-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* system stats */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="観測データ" value={String(db.observations)} />
        <Kpi label="動画" value={String(db.videos)} />
        <Kpi label="画像" value={String(db.images)} />
        <Kpi label="DBサイズ" value={fmtBytes(db.db_bytes)} />
      </section>
<section className="card mb-6">
        <h2 className="label mb-3">ストレージ内訳</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Info label="動画ファイル" value={fmtBytes(db.video_storage_bytes)} />
          <Info label="画像ファイル" value={fmtBytes(db.image_storage_bytes)} />
          <Info label="アップロード上限" value={`${stats.max_upload_mb} MB`} />
          <Info label="メタデータ DB" value={fmtBytes(db.db_bytes)} />
        </div>
      </section>

      <div className="mb-6">
        <FarmersOverviewSection obs={obs} />
      </div>

      <div className="mb-6">
        <SiteSettingsSection
          initial={stats.settings.site}
          onSaved={(m) => {
            flash(m.kind, m.text);
            if (m.kind === 'ok') siteCtx.refresh();
          }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ThresholdsSection initial={stats.settings.health_thresholds} onSaved={(m) => flash(m.kind, m.text)} />
        <SoilConfigSection config={stats.soil.config} configured={stats.soil.configured} onTest={(m) => flash(m.kind, m.text)} />
      </div>

      <div className="mt-6">
        <SensorAlertSection
          alerts={stats.soil.alerts || {}}
          soilConfig={stats.soil.config || {}}
          onTest={(m) => flash(m.kind, m.text)}
        />
      </div>

      <div className="mt-6">
        <DataSection
          videos={videos}
          images={images}
          obs={obs}
          onChanged={loadAll}
          flash={(m) => flash(m.kind, m.text)}
        />
      </div>

      <div className="mt-6">
        <FarmersSection flash={(m) => flash(m.kind, m.text)} />
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card card-hover">
      <p className="stat-label">{label}</p>
      <p className="mt-1 stat-value">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums text-neutral-800">{value}</p>
    </div>
  );
}

function ThresholdsSection({
  initial,
  onSaved,
}: {
  initial: HealthThresholds;
  onSaved: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
  const [form, setForm] = useState<HealthThresholds>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const set = (key: keyof HealthThresholds, val: string) => {
    setForm((prev) => ({ ...prev, [key]: parseFloat(val) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings({ health_thresholds: form });
      onSaved({ kind: 'ok', text: '体調判定の閾値を保存しました。' });
    } catch (e: any) {
      onSaved({ kind: 'err', text: e.message || '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2 className="label mb-1">体調判定の閾値</h2>
      <p className="mb-3 text-xs text-neutral-400">
        0〜1の健康スコアを各状態に振り分ける境界値を設定します。
      </p>
      <div className="grid grid-cols-3 gap-3">
        <ThreshField label="健康 (happy)" value={form.happy} color={healthColor('happy')} onChange={(v) => set('happy', v)} />
        <ThreshField label="良好 (good)" value={form.good} color={healthColor('good')} onChange={(v) => set('good', v)} />
        <ThreshField label="注意 (caution)" value={form.caution} color={healthColor('caution')} onChange={(v) => set('caution', v)} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-neutral-400">
          注意未満は「要管理」として扱われます。
        </p>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? '保存中…' : '設定を保存'}
        </button>
      </div>
    </section>
  );
}

function ThreshField({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-100 p-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <label className="text-xs text-neutral-500">{label}</label>
      </div>
      <input
        type="number"
        step="0.05"
        min="0"
        max="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-2 px-2.5 py-1.5 text-sm"
      />
    </div>
  );
}

function SoilConfigSection({
  config,
  configured,
  onTest,
}: {
  config: Record<string, any>;
  configured: boolean;
  onTest: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setForm({
      api_base_url: config.api_base_url || '',
      api_key: config.api_key || '',
      default_kit_id: config.default_kit_id || 'default',
      timeout: config.timeout != null ? String(config.timeout) : '10',
      cache_ttl: config.cache_ttl != null ? String(config.cache_ttl) : '60',
    });
  }, [config]);

  const field = (k: string) => form[k] || '';

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        api_base_url: field('api_base_url'),
        api_key: field('api_key'),
        default_kit_id: field('default_kit_id'),
      };
      const num = (v: string) => (v.trim() ? parseFloat(v) : undefined);
      const to = num(field('timeout'));
      const ttl = num(field('cache_ttl'));
      if (to != null) payload.timeout = to;
      if (ttl != null) payload.cache_ttl = ttl;
      await api.saveSoilConfig(payload);
      onTest({ kind: 'ok', text: '土壌水分の設定を保存しました。' });
    } catch (e: any) {
      onTest({ kind: 'err', text: e.message || '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.testSoil();
      if (r.source === 'api') {
        const sm = r.soil_moisture;
        onTest({
          kind: 'ok',
          text: `自動取得OK: センサー1 ${sm.sensor1_moisture_percent ?? '-'}% / センサー2 ${sm.sensor2_moisture_percent ?? '-'}%`,
        });
      } else {
        onTest({
          kind: 'err',
          text: `自動取得できません（source: ${r.source}）: ${r.health?.message || '未設定か接続不可'}`,
        });
      }
    } catch (e: any) {
      onTest({ kind: 'err', text: e.message || 'テスト取得に失敗しました' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="card">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="label">土壌水分の自動取得</h2>
        <span className={`badge ${configured ? 'bg-health-good/10 text-health-good' : 'bg-neutral-100 text-neutral-500'}`}>
          {configured ? '有効' : '未設定'}
        </span>
      </div>
      <p className="mb-3 text-xs text-neutral-400">
        UKK-KOSEN Cloudflare D1 API から自動取得します。未設定なら手動入力にフォールバックします。
      </p>
      <div className="space-y-2">
        <TextField label="APIベースURL" value={field('api_base_url')} onChange={(v) => setForm((p) => ({ ...p, api_base_url: v }))} placeholder="https://xxxx.workers.dev" />
        <TextField label="APIキー（X-Sensor-Api-Key）" value={field('api_key')} onChange={(v) => setForm((p) => ({ ...p, api_key: v }))} placeholder="（設定済みならマスク表示）" mask />
        <TextField label="デフォルトKit ID" value={field('default_kit_id')} onChange={(v) => setForm((p) => ({ ...p, default_kit_id: v }))} placeholder="default" />
        <div className="grid grid-cols-2 gap-2">
          <TextField label="タイムアウト (秒)" value={field('timeout')} onChange={(v) => setForm((p) => ({ ...p, timeout: v }))} placeholder="10" />
          <TextField label="キャッシュ (秒)" value={field('cache_ttl')} onChange={(v) => setForm((p) => ({ ...p, cache_ttl: v }))} placeholder="60" />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={test} disabled={testing} className="btn-secondary">
          {testing ? 'テスト中…' : 'テスト取得'}
        </button>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? '保存中…' : '設定を保存'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        保存先: backend/config/soil_moisture.yaml（APIキーはマスク表示されます）
      </p>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  mask,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mask?: boolean;
}) {
  return (
<div>
      <label className="mb-1 block text-xs text-neutral-500">{label}</label>
      <input
        type={mask ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input px-2.5 py-1.5 text-sm"
      />
    </div>
  );
}

const ALERT_META: Record<string, { label: string; cls: string; dot: string }> = {
  ok: { label: '正常', cls: 'bg-health-good/10 text-health-good', dot: '#4c9a5a' },
  stale: { label: 'データ更新停止', cls: 'bg-health-danger/10 text-health-danger', dot: '#c25a4a' },
  api_error: { label: 'API接続エラー', cls: 'bg-health-danger/10 text-health-danger', dot: '#c25a4a' },
  risk: { label: '水分値の異常', cls: 'bg-health-caution/10 text-health-caution', dot: '#c99a2e' },
  unconfigured: { label: '監視対象外', cls: 'bg-neutral-100 text-neutral-500', dot: '#a0a0a0' },
};

const EVENT_SEV: Record<string, string> = {
  open: 'bg-health-danger/10 text-health-danger',
  remind: 'bg-health-caution/10 text-health-caution',
  recovered: 'bg-health-good/10 text-health-good',
  test: 'bg-neutral-100 text-neutral-500',
};

function fmtNum(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? '—' : String(v);
}

function SensorAlertSection({
  alerts,
  soilConfig,
  onTest,
}: {
  alerts: Record<string, any>;
  soilConfig: Record<string, any>;
  onTest: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
  const [status, setStatus] = useState<SensorAlertsStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [checkInterval, setCheckInterval] = useState('10');
  const [staleHours, setStaleHours] = useState('6');
  const [dryPercent, setDryPercent] = useState('15');
  const [wetPercent, setWetPercent] = useState('85');
  const [remind, setRemind] = useState('6, 24, 72, 168');
  const [notifyRisk, setNotifyRisk] = useState(true);
  const [recoverNotify, setRecoverNotify] = useState(true);
  const [inapp, setInapp] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookToken, setWebhookToken] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.sensorAlerts());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const ch = alerts?.channels || {};
    setEnabled(alerts?.enabled ?? true);
    setCheckInterval(String(alerts?.check_interval_minutes ?? 10));
    setStaleHours(String(alerts?.stale_hours ?? 6));
    setDryPercent(String(alerts?.dry_percent ?? 15));
    setWetPercent(String(alerts?.wet_percent ?? 85));
    setRemind(String((alerts?.remind_hours || [6, 24, 72, 168]).join(', ')));
    setNotifyRisk(alerts?.notify_risk ?? true);
    setRecoverNotify(alerts?.recover_notify ?? true);
    setInapp(ch?.inapp ?? true);
    setWebhookUrl(ch?.webhook_url || '');
    setWebhookToken(ch?.webhook_token || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, refresh]);

  const save = async () => {
    setSaving(true);
    try {
      const num = (v: string) => (v.trim() ? parseFloat(v) : undefined);
      const remindHours = remind
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n));
      const payload: Record<string, any> = {
        ...(soilConfig || {}),
        alerts: {
          enabled,
          check_interval_minutes: num(checkInterval),
          stale_hours: num(staleHours),
          dry_percent: num(dryPercent),
          wet_percent: num(wetPercent),
          notify_risk: notifyRisk,
          recover_notify: recoverNotify,
          remind_hours: remindHours,
          channels: { inapp, webhook_url: webhookUrl.trim(), webhook_token: webhookToken.trim() },
        },
      };
      await api.saveSoilConfig(payload);
      onTest({ kind: 'ok', text: 'センサー監視・通知の設定を保存しました。' });
      refresh();
    } catch (e: any) {
      onTest({ kind: 'err', text: e.message || '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.testSensorNotification();
      const ok = r.results.filter((c: any) => c.ok);
      const fail = r.results.filter((c: any) => !c.ok);
      if (ok.length === 0) {
        onTest({ kind: 'err', text: '有効な通知チャネルがありません。アプリ内通知またはWebhookを有効にしてください。' });
      } else if (fail.length > 0) {
        onTest({
          kind: 'err',
          text: `テスト送信: ${ok.map((c: any) => c.channel).join('、')} OK／${fail.map((c: any) => `${c.channel}（${c.detail || '失敗'}）`).join('、')}`,
        });
      } else {
        onTest({ kind: 'ok', text: `テスト通知を送信しました（${ok.map((c: any) => c.channel).join('、')}）。` });
      }
      refresh();
    } catch (e: any) {
      onTest({ kind: 'err', text: e.message || 'テスト送信に失敗しました' });
    } finally {
      setTesting(false);
    }
  };

  const ev = status?.evaluation;
  const meta = ALERT_META[ev?.mode || 'unconfigured'] || ALERT_META.unconfigured;
  const state = status?.state;
  const openAlert = !!state && ['stale', 'api_error', 'risk'].includes(state.mode);
  const openedAt = state?.opened_at ? new Date(state.opened_at) : null;
  const elapsedH =
    openedAt && !Number.isNaN(openedAt.getTime()) ? Math.max(0, (Date.now() - openedAt.getTime()) / 3600000) : null;
  const age = ev?.age_hours != null ? Math.round(ev.age_hours) : null;
  const bg = `${meta.dot}0d`;
  const border = `${meta.dot}33`;

  return (
    <section className="card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="label">土壌センサー監視・通知</h2>
        <div className="flex items-center gap-2">
          <span className={`badge ${meta.cls}`}>{meta.label}</span>
          {status && !status.enabled && <span className="badge bg-neutral-100 text-neutral-500">監視無効</span>}
        </div>
      </div>
      <p className="mb-3 text-xs text-neutral-400">
        センサーの停止・水分値異常・API接続エラーを検知し、アプリ内通知とWebhookへ届けます。
        異常は即時通知 → 段階リマインド → 復旧通知の順に送信されます。
      </p>

      {ev && (
        <div className="mb-4 rounded-lg border p-3 text-sm" style={{ borderColor: border, background: bg }}>
          <p className="font-medium" style={{ color: meta.dot }}>
            {ev.title}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs text-neutral-700">{ev.body}</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-500">
            {ev.kit_id && <span>Kit: {ev.kit_id}</span>}
            {ev.measured_at && <span>最終更新: {fmtDateTime(ev.measured_at)}</span>}
            {age != null && <span>データ経過: {age}時間</span>}
            <span>センサー1 {fmtNum(ev.sensor1)}%</span>
            <span>センサー2 {fmtNum(ev.sensor2)}%</span>
            {ev.error && <span className="text-health-danger">エラー: {ev.error}</span>}
          </div>
          {openAlert && (
            <div className="mt-2 text-[11px] text-health-danger">
              検知から{elapsedH != null ? `${Math.round(elapsedH)}時間` : '—'}経過
              {state.level > 0 ? `・リマインド送信済み ${state.level} 回` : ''}
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <label className="text-sm text-neutral-700">センサー監視を有効にする</label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TextField label="チェック間隔 (分)" value={checkInterval} onChange={setCheckInterval} placeholder="10" />
        <TextField label="停止判定 (時間)" value={staleHours} onChange={setStaleHours} placeholder="6" />
        <TextField label="乾燥閾値 (%)" value={dryPercent} onChange={setDryPercent} placeholder="15" />
        <TextField label="過湿閾値 (%)" value={wetPercent} onChange={setWetPercent} placeholder="85" />
      </div>
      <div className="mt-2">
        <TextField label="リマインド間隔 (時間・カンマ区切り)" value={remind} onChange={setRemind} placeholder="6, 24, 72, 168" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={notifyRisk} onChange={(e) => setNotifyRisk(e.target.checked)} />
          水分値異常を通知
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={recoverNotify} onChange={(e) => setRecoverNotify(e.target.checked)} />
          復旧通知
        </label>
      </div>

      <div className="mt-4 mb-2 border-t pt-3">
        <p className="mb-2 text-xs font-medium text-neutral-500">通知チャネル</p>
        <label className="mb-2 flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={inapp} onChange={(e) => setInapp(e.target.checked)} />
          アプリ内通知（お知らせ）
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField label="Webhook URL（Slack/Discord/Teams等）" value={webhookUrl} onChange={setWebhookUrl} placeholder="https://hooks.example.com/…" />
          <TextField label="LINE Notifyトークン（任意）" value={webhookToken} onChange={setWebhookToken} placeholder="設定済みならマスク表示" mask />
        </div>
        <p className="mt-1 text-[11px] text-neutral-400">
          トークン未指定ならJSON Webhook、指定時はLINE Notify形式で送信します。
        </p>
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={test} disabled={testing} className="btn-secondary">
          {testing ? '送信中…' : 'テスト通知を送信'}
        </button>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? '保存中…' : '設定を保存'}
        </button>
      </div>

      {status && status.events.length > 0 && (
        <div className="mt-5">
          <p className="label mb-2">送信履歴</p>
          <div className="max-h-64 overflow-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b text-neutral-500">
                  <th className="px-3 py-2 font-medium">日時</th>
                  <th className="px-3 py-2 font-medium">種別</th>
                  <th className="px-3 py-2 font-medium">内容</th>
                  <th className="px-3 py-2 font-medium">チャネル</th>
                </tr>
              </thead>
              <tbody>
                {status.events.map((e: SensorAlertEvent) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-500">{fmtDateTime(e.created_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`badge text-[10px] ${EVENT_SEV[e.severity] || EVENT_SEV.test}`}>{e.severity}</span>
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-neutral-700">{e.title}</p>
                      <p className="whitespace-pre-line text-[11px] text-neutral-400">{e.body}</p>
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{e.channels || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function DataSection({
  videos,
  images,
  obs,
  onChanged,
  flash,
}: {
  videos: Video[];
  images: ImageAsset[];
  obs: Observation[];
  onChanged: () => void;
  flash: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const clean = async () => {
    setBusy('clear');
    try {
      await api.clearObservations();
      flash({ kind: 'ok', text: '全観測データを削除しました。' });
      setConfirmClear(false);
      onChanged();
    } catch (e: any) {
      flash({ kind: 'err', text: e.message || '削除に失敗しました' });
    } finally {
      setBusy(null);
    }
  };

  const delVideo = async (id: number) => {
    setBusy(`v${id}`);
    try {
      await api.deleteVideo(id);
      flash({ kind: 'ok', text: '動画を削除しました。' });
      onChanged();
    } catch (e: any) {
      flash({ kind: 'err', text: e.message || '削除に失敗しました' });
    } finally {
      setBusy(null);
    }
  };

  const delImage = async (id: number) => {
    setBusy(`i${id}`);
    try {
      await api.deleteImage(id);
      flash({ kind: 'ok', text: '画像を削除しました。' });
      onChanged();
    } catch (e: any) {
      flash({ kind: 'err', text: e.message || '削除に失敗しました' });
    } finally {
      setBusy(null);
    }
  };

  const delObs = async (id: number) => {
    setBusy(`o${id}`);
    try {
      await api.deleteObservation(id);
      flash({ kind: 'ok', text: '観測データを削除しました。' });
      onChanged();
    } catch (e: any) {
      flash({ kind: 'err', text: e.message || '削除に失敗しました' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="label">データ管理</h2>
        {confirmClear ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-health-danger">全観測データを削除します。よろしいですか？</span>
            <button onClick={clean} disabled={busy === 'clear'} className="btn-danger">
              はい、削除
            </button>
            <button onClick={() => setConfirmClear(false)} className="btn-secondary">キャンセル</button>
          </div>
        ) : (
          <button onClick={() => setConfirmClear(true)} className="btn-danger">
            全観測データを消去
          </button>
        )}
      </div>

      <h3 className="label mb-2 mt-4 text-sm">動画（{videos.length}）</h3>
      {videos.length === 0 ? (
        <p className="text-sm text-neutral-400">動画なし</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
{videos.map((v) => {
            const poster = obs.find((o) => o.video_id === v.id && o.annotated_path)?.annotated_path ?? null;
            return (
            <li key={v.id} className="py-2">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{v.filename}</span>
                <span className="text-xs text-neutral-400">{fmtBytes(v.size_bytes)}</span>
                <button
                  onClick={() => setPreviewId(previewId === v.id ? null : v.id)}
                  className="btn-secondary btn-sm"
                >
                  {previewId === v.id ? '閉じる' : '再生'}
                </button>
                <button onClick={() => delVideo(v.id)} disabled={busy === `v${v.id}`} className="btn-danger btn-sm">
                  削除
                </button>
              </div>
              {previewId === v.id && v.storage_path && (
                <div className="mt-2">
                  <VideoPreview
                    src={v.storage_path}
                    poster={poster}
                    title={v.filename}
                    durationText={`長さ ${formatDuration(v.duration_sec)}`}
                  />
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}

      <h3 className="label mb-2 mt-4 text-sm">画像（{images.length}）</h3>
      {images.length === 0 ? (
        <p className="text-sm text-neutral-400">画像なし</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {images.map((im) => (
            <li key={im.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{im.filename}</span>
              <span className="text-xs text-neutral-400">{fmtBytes(im.size_bytes)}</span>
              <button onClick={() => delImage(im.id)} disabled={busy === `i${im.id}`} className="btn-danger btn-sm">
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="label mb-2 mt-4 text-sm">観測データ（{obs.length}）</h3>
      {obs.length === 0 ? (
        <p className="text-sm text-neutral-400">観測データなし</p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
<thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-neutral-400">
                <th className="pb-2 pr-3 font-medium">ID</th>
                <th className="pb-2 pr-3 font-medium">出典</th>
                <th className="pb-2 pr-3 font-medium">農家</th>
                <th className="pb-2 pr-3 font-medium">体調</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {obs.map((o) => {
                const st = o.health_state;
                return (
                  <tr key={o.id} className="border-t border-neutral-100">
                    <td className="py-2 pr-3 tabular-nums text-neutral-500">{o.id}</td>
                    <td className="py-2 pr-3 text-neutral-700">{o.filename || '画像/動画'}</td>
                    <td className="py-2 pr-3 text-neutral-600">
                      {o.owner ? farmerLabel(o.owner) : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {st ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: healthColor(st.label) }} />
                          <span className="text-neutral-700">{healthJa(st.label)}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => delObs(o.id)} disabled={busy === `o${o.id}`} className="btn-danger btn-sm">
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FarmersOverviewSection({ obs }: { obs: Observation[] }) {
  const [farmers, setFarmers] = useState<FarmerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listFarmers()
      .then(setFarmers)
      .catch(() => setFarmers([]))
      .finally(() => setLoading(false));
  }, []);

  const totals = farmers.reduce(
    (acc, f) => ({
      videos: acc.videos + f.video_count,
      images: acc.images + f.image_count,
      obs: acc.obs + f.observation_count,
    }),
    { videos: 0, images: 0, obs: 0 }
  );

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="label">農家別データ集計</h2>
          <p className="mt-1 text-xs text-neutral-400">
            全農家のデータ量と体調判定の分布をまとめて確認できます。
          </p>
        </div>
        {!loading && (
          <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
            <span className="badge bg-neutral-100 text-neutral-600">農家 {farmers.length}</span>
            <span className="badge bg-neutral-100 text-neutral-600">観測 {totals.obs}</span>
            <span className="badge bg-neutral-100 text-neutral-600">動画 {totals.videos}</span>
            <span className="badge bg-neutral-100 text-neutral-600">画像 {totals.images}</span>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400">読み込み中…</p>
      ) : farmers.length === 0 ? (
        <p className="text-sm text-neutral-400">まだ農家アカウントがありません。</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {farmers.map((f) => {
            const total = f.observation_count || 0;
            const maxSeg = Math.max(1, ...HEALTH_ORDER.map((k) => f.states?.[k] || 0));
            return (
              <div key={f.id} className="rounded-lg border border-neutral-100 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-800">{farmerLabel(f)}</p>
                    <p className="text-xs text-neutral-400">
                      @{f.username}
                      {f.display_name ? ` · ${f.display_name}` : ''}
                    </p>
                  </div>
                  <span className={`badge ${f.is_active ? 'bg-health-good/10 text-health-good' : 'bg-neutral-100 text-neutral-500'}`}>
                    {f.is_active ? '利用中' : '停止中'}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                    <p className="stat-value text-sm">{f.observation_count}</p>
                    <p className="text-[10px] text-neutral-400">観測</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                    <p className="stat-value text-sm">{f.video_count}</p>
                    <p className="text-[10px] text-neutral-400">動画</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                    <p className="stat-value text-sm">{f.image_count}</p>
                    <p className="text-[10px] text-neutral-400">画像</p>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    {HEALTH_ORDER.map((k) => {
                      const n = f.states?.[k] || 0;
                      if (!n) return null;
                      return (
                        <span
                          key={k}
                          style={{
                            width: `${(n / maxSeg) * 100}%`,
                            background: healthColor(k),
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    {HEALTH_ORDER.map((k) => (
                      <span key={k} className="inline-flex items-center gap-1 text-neutral-500">
                        <span className="h-2 w-2 rounded-full" style={{ background: healthColor(k) }} />
                        {healthJa(k)} {f.states?.[k] || 0}
                      </span>
                    ))}
                  </div>
                </div>

                {(() => {
                  const farmerObs = obs.filter((o) => o.user_id === f.id);
                  if (farmerObs.length === 0) return null;
                  return (
                    <div className="mt-3">
                      <p className="mb-1 text-[11px] font-medium text-neutral-400">スコア推移</p>
                      <TrendChart obs={farmerObs} width={440} height={150} minWidth={320} />
                    </div>
                  );
                })()}

                <p className="mt-2 text-[11px] text-neutral-400">
                  最終観測: {fmtDateTime(f.latest_observed_at)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FarmersSection({ flash }: { flash: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const [farmers, setFarmers] = useState<FarmerRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<{ display_name: string; farm_name: string; farm_variety: string; farm_area: string; farm_location: string }>({
    display_name: '',
    farm_name: '',
    farm_variety: '',
    farm_area: '',
    farm_location: '',
  });
  const [pwdTarget, setPwdTarget] = useState<number | null>(null);
  const [newPwd, setNewPwd] = useState('');

  const load = useCallback(async () => {
    setFarmers(await api.listFarmers().catch(() => [] as FarmerRecord[]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (f: FarmerRecord) => {
    setEditing(f.id);
    setForm({
      display_name: f.display_name || '',
      farm_name: f.farm_name || '',
      farm_variety: f.farm_variety || '',
      farm_area: f.farm_area || '',
      farm_location: f.farm_location || '',
    });
  };

  const saveEdit = async () => {
    if (editing == null) return;
    setBusy(`e${editing}`);
    try {
      await api.updateFarmer(editing, form);
      flash({ kind: 'ok', text: '農家情報を更新しました。' });
      setEditing(null);
      await load();
    } catch (e: any) {
      flash({ kind: 'err', text: e.message || '更新に失敗しました' });
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (f: FarmerRecord) => {
    setBusy(`a${f.id}`);
    try {
      await api.updateFarmer(f.id, { is_active: !Boolean(f.is_active) });
      flash({ kind: 'ok', text: '利用状態を変更しました。' });
      await load();
    } catch (e: any) {
      flash({ kind: 'err', text: e.message || '更新に失敗しました' });
    } finally {
      setBusy(null);
    }
  };

  const resetPwd = async () => {
    if (pwdTarget == null) return;
    if (!newPwd || newPwd.length < 6) {
      flash({ kind: 'err', text: 'パスワードは6文字以上にしてください。' });
      return;
    }
    setBusy(`p${pwdTarget}`);
    try {
      await api.resetFarmerPassword(pwdTarget, newPwd);
      flash({ kind: 'ok', text: 'パスワードを再設定しました。' });
      setPwdTarget(null);
      setNewPwd('');
    } catch (e: any) {
      flash({ kind: 'err', text: e.message || '再設定に失敗しました' });
    } finally {
      setBusy(null);
    }
  };

  const del = async (f: FarmerRecord) => {
    if (!window.confirm(`農家「${f.display_name || f.username}」を削除しますか？関連する観測データも削除されます。`)) return;
    setBusy(`d${f.id}`);
    try {
      await api.deleteFarmer(f.id);
      flash({ kind: 'ok', text: '農家を削除しました。' });
      await load();
    } catch (e: any) {
      flash({ kind: 'err', text: e.message || '削除に失敗しました' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="label">農家管理</h2>
          <p className="mt-1 text-xs text-neutral-400">
            登録済みの農家アカウントを管理します。農家は自己登録フォームから作成できます。
          </p>
        </div>
      </div>

      {farmers.length === 0 ? (
        <p className="text-sm text-neutral-400">まだ農家アカウントがありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400">
                <th className="pb-2 pr-3 font-medium">ユーザー名</th>
                <th className="pb-2 pr-3 font-medium">名前 / 農園</th>
                <th className="pb-2 pr-3 font-medium">データ</th>
                <th className="pb-2 pr-3 font-medium">状態</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {farmers.map((f) => (
                <tr key={f.id} className="border-t border-neutral-100 align-top">
                  <td className="py-2.5 pr-3 font-medium text-neutral-800">{f.username}</td>
                  <td className="py-2.5 pr-3 text-neutral-600">
                    {editing === f.id ? (
                      <div className="space-y-1">
                        <input
                          value={form.display_name}
                          onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))}
                          placeholder="名前"
                          className="input px-2 py-1 text-xs"
                        />
                        <input
                          value={form.farm_name}
                          onChange={(e) => setForm((p) => ({ ...p, farm_name: e.target.value }))}
                          placeholder="農園名"
                          className="input px-2 py-1 text-xs"
                        />
                        <div className="flex gap-1">
                          <input
                            value={form.farm_variety}
                            onChange={(e) => setForm((p) => ({ ...p, farm_variety: e.target.value }))}
                            placeholder="品種"
                            className="input px-2 py-1 text-xs"
                          />
                          <input
                            value={form.farm_area}
                            onChange={(e) => setForm((p) => ({ ...p, farm_area: e.target.value }))}
                            placeholder="面積"
                            className="input px-2 py-1 text-xs"
                          />
                        </div>
                        <input
                          value={form.farm_location}
                          onChange={(e) => setForm((p) => ({ ...p, farm_location: e.target.value }))}
                          placeholder="所在地"
                          className="input px-2 py-1 text-xs"
                        />
                      </div>
                    ) : (
                      <>
                        <span className="block">{f.display_name || '—'}</span>
                        <span className="block text-xs text-neutral-400">{f.farm_name || '—'}</span>
                        {(f.farm_variety || f.farm_area || f.farm_location) && (
                          <span className="mt-1 block text-[11px] text-neutral-400">
                            {[f.farm_variety, f.farm_area, f.farm_location].filter(Boolean).join(' ・ ') || '—'}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-neutral-500">
                    <span className="block">動画 {f.video_count}</span>
                    <span className="block">画像 {f.image_count}</span>
                    <span className="block">観測 {f.observation_count}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <button
                      onClick={() => toggleActive(f)}
                      className={`badge ${f.is_active ? 'bg-health-good/10 text-health-good' : 'bg-neutral-100 text-neutral-500'}`}
                    >
                      {f.is_active ? '利用中' : '停止中'}
                    </button>
                  </td>
                  <td className="py-2.5">
                    {editing === f.id ? (
                      <div className="flex flex-col gap-1">
                        <button onClick={saveEdit} disabled={busy === `e${f.id}`} className="btn-primary btn-sm">
                          保存
                        </button>
                        <button onClick={() => setEditing(null)} className="btn-secondary btn-sm">
                          戻る
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <button onClick={() => startEdit(f)} className="btn-secondary btn-sm">編集</button>
                        <button onClick={() => { setPwdTarget(f.id); setNewPwd(''); }} className="btn-secondary btn-sm">PW変更</button>
                        <button onClick={() => del(f)} disabled={busy === `d${f.id}`} className="btn-danger btn-sm">削除</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pwdTarget != null && (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <p className="mb-2 text-sm text-neutral-700">
            パスワード再設定（{farmers.find((f) => f.id === pwdTarget)?.username}）
          </p>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="新しいパスワード（6文字以上）"
              className="input flex-1 px-2.5 py-1.5 text-sm"
            />
            <button onClick={resetPwd} disabled={busy === `p${pwdTarget}`} className="btn-primary btn-sm">設定</button>
            <button onClick={() => setPwdTarget(null)} className="btn-secondary btn-sm">閉じる</button>
          </div>
        </div>
      )}
    </section>
  );
}

function SiteSettingsSection({
  initial,
  onSaved,
}: {
  initial: SiteSettings;
  onSaved: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
  const [form, setForm] = useState<SiteSettings>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings({
        site: {
          name: form.name.trim() || undefined,
          subtitle: form.subtitle.trim() || undefined,
          accent: form.accent.trim() || undefined,
        },
      });
      onSaved({ kind: 'ok', text: 'サイト設定を保存しました。' });
    } catch (e: any) {
      onSaved({ kind: 'err', text: e.message || '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="label">サイト設定</h2>
          <p className="mt-1 text-xs text-neutral-400">
            サイト名・サブタイトル・アクセントカラーを変更します。保存すると画面上部のロゴ・サイドバーにも反映されます。
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">サイト名</label>
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="サイト名"
            className="input w-full px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">サブタイトル</label>
          <input
            value={form.subtitle}
            onChange={(e) => setForm((p) => ({ ...p, subtitle: e.target.value }))}
            placeholder="サブタイトル"
            className="input w-full px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">アクセントカラー</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(form.accent) ? form.accent : '#2b2b2b'}
              onChange={(e) => setForm((p) => ({ ...p, accent: e.target.value }))}
              className="h-9 w-12 shrink-0 cursor-pointer rounded border border-neutral-200 bg-white p-0.5"
            />
            <input
              value={form.accent}
              onChange={(e) => setForm((p) => ({ ...p, accent: e.target.value }))}
              placeholder="#2b2b2b"
              className="input flex-1 px-3 py-2 font-mono text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">プレビュー</label>
          <div className="flex items-center gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-2.5">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white"
              style={{ background: /^#[0-9a-fA-F]{6}$/.test(form.accent) ? form.accent : '#2b2b2b' }}
            >
              <IconOlive size={16} className="text-white/90" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-800">{form.name || 'サイト名'}</p>
              <p className="truncate text-[10px] text-neutral-400">{form.subtitle || 'サブタイトル'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? '保存中…' : 'サイト設定を保存'}
        </button>
      </div>
    </section>
  );
}

