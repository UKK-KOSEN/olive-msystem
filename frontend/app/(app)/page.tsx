'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  formatBytes,
  formatDuration,
  formatTimestamp,
  HealthState,
  Video,
  Observation,
  OliveStatus,
  SoilMoistureInput,
  SoilMoistureData,
  SoilStatus,
  FarmerRecord,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TrendChart, StatePill, healthJa, healthColor } from '@/components/charts';
import { SoilDisplay, SoilInputPanel } from '@/components/SoilComponent';
import { UpscaledBadge } from '@/components/UpscaledBadge';
import { PageHeader } from '@/components/PageHeader';
import ErrorNotice from '@/components/ErrorNotice';
import {
  IconVideo,
  IconImage,
  IconOlive,
  IconChart,
  IconBell,
  IconFilm,
  IconDroplet,
  IconLeaf,
  IconActivity,
  IconSparkle,
  IconChevronRight,
} from '@/components/icons';

function actionGuidance(st: HealthState): string {
  let advice = '';
  switch (st.label) {
    case 'happy':
      advice = '特に問題はありません。このまま観察を続け、定期的に解析してください。';
      break;
    case 'good':
      advice = '状態は良好です。大きな対応は不要ですが、水分管理は継続してください。';
      break;
    case 'caution':
      advice = '水分・葉の状態に注意が必要です。水やりや日陰・通風対策を検討してください。';
      break;
    case 'danger':
      advice = '早めの対応が必要です。灌水・剪定・土壌水分の確認を優先してください。';
      break;
    default:
      advice = '観察を続けてください。';
  }
  if (st.water_stress != null && st.water_stress > 0.5) {
    advice += ' 水分ストレスが高めのため、灌水を優先してください。';
  }
  return advice;
}

function StatusBadge({ status }: { status: Video['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: '待機中', cls: 'bg-neutral-100 text-neutral-600' },
    processing: { label: '解析中', cls: 'bg-olive-50 text-olive-700' },
    done: { label: '完了', cls: 'bg-health-good/10 text-health-good' },
    error: { label: 'エラー', cls: 'bg-health-danger/10 text-health-danger' },
  };
  const m = map[status] || map.pending;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [videos, setVideos] = useState<Video[]>([]);
  const [allObs, setAllObs] = useState<Observation[]>([]);
  const [farmers, setFarmers] = useState<FarmerRecord[]>([]);
  const [farmerId, setFarmerId] = useState<number | null>(null);
  const [oliveStatus, setOliveStatus] = useState<OliveStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [obsByVideo, setObsByVideo] = useState<Record<number, Observation[]>>({});
  const [obsErrors, setObsErrors] = useState<Record<number, string>>({});
  const [running, setRunning] = useState<number | null>(null);
  const [timeSpec, setTimeSpec] = useState<Record<number, string>>({});
  const [soilInputs, setSoilInputs] = useState<Record<number, SoilMoistureInput | undefined>>({});
  const [treeIdInputs, setTreeIdInputs] = useState<Record<number, string>>({});
  const [droneModes, setDroneModes] = useState<Record<number, boolean>>({});
  const [upscaleModes, setUpscaleModes] = useState<Record<number, boolean>>({});
  const [soilStatus, setSoilStatus] = useState<SoilStatus | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadVideos = useCallback(async () => {
    try {
      const vs = await api.videos();
      setVideos(vs);
      setDataError(null);
    } catch (e: any) {
      setDataError(e?.message || '動画一覧の取得に失敗しました');
    }
  }, []);

  const loadAllObs = useCallback(async () => {
    try {
      const obs = await api.observations();
      setAllObs(obs);
      setDataError(null);
    } catch (e: any) {
      setDataError(e?.message || '観測データの取得に失敗しました');
    }
  }, []);

  const loadObs = useCallback(async (videoId: number) => {
    try {
      const obs = await api.observations(videoId);
      setObsByVideo((prev) => ({ ...prev, [videoId]: obs }));
      setObsErrors((prev) => { const n = { ...prev }; delete n[videoId]; return n; });
    } catch (e: any) {
      setObsByVideo((prev) => ({ ...prev, [videoId]: [] }));
      setObsErrors((prev) => ({ ...prev, [videoId]: e?.message || '解析結果の取得に失敗しました' }));
    }
  }, []);

  useEffect(() => {
    loadVideos();
    loadAllObs();
    api.oliveStatus(isAdmin ? farmerId ?? undefined : undefined).then(setOliveStatus).catch(() => setOliveStatus(null));
    api.soilStatus().then(setSoilStatus).catch(() => setSoilStatus(null));
  }, [loadVideos, loadAllObs]);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .listFarmers()
      .then(setFarmers)
      .catch(() => {});
  }, [isAdmin]);

  // Admin sees every farmer's data merged in one line otherwise;
  // scope the dashboard to a farmer so the trend plots like a farmer account.
  useEffect(() => {
    if (!isAdmin || farmerId != null) return;
    const groups = new Map<number, { latest: number; count: number }>();
    for (const o of allObs) {
      if (o.user_id == null) continue;
      const t = new Date(o.observed_at).getTime() || 0;
      const g = groups.get(o.user_id) ?? { latest: 0, count: 0 };
      g.count += 1;
      if (t > g.latest) g.latest = t;
      groups.set(o.user_id, g);
    }
    const ranked = [...groups.entries()].sort(
      (a, b) => b[1].latest - a[1].latest || b[1].count - a[1].count
    );
    if (ranked.length > 0) setFarmerId(ranked[0][0]);
  }, [allObs, isAdmin, farmerId]);

  // Never merge farmers into one trend line for admins: no farmer selected -> no chart.
  const scopedObs = useMemo(
    () => (isAdmin ? (farmerId != null ? allObs.filter((o) => o.user_id === farmerId) : []) : allObs),
    [allObs, isAdmin, farmerId]
  );

  // Re-fetch the hero health so an admin-selected farmer shows the same score
  // as the farmer's own account (matches the scoped trend chart).
  useEffect(() => {
    if (!isAdmin || farmerId == null) return;
    api.oliveStatus(farmerId).then(setOliveStatus).catch(() => setOliveStatus(null));
  }, [isAdmin, farmerId]);

  // poll while processing
  useEffect(() => {
    const t = setInterval(async () => {
      if (videos.some((v) => v.status === 'processing')) {
        loadVideos();
        loadAllObs();
        api.oliveStatus(isAdmin ? farmerId ?? undefined : undefined).then(setOliveStatus).catch(() => setOliveStatus(null));
        videos.forEach((v) => {
          if (v.status === 'done') loadObs(v.id);
        });
      }
    }, 3000);
    return () => clearInterval(t);
  }, [videos, loadObs, loadVideos, loadAllObs]);

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    setUploadError(null);
    try {
      for (const f of files) {
        await api.upload(f);
      }
      await loadVideos();
    } catch (e: any) {
      setUploadError(e.message || 'アップロードに失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) handleFiles(files);
  };

  const runAnalysis = async (video: Video, customTimes?: string, soil?: SoilMoistureInput,
                              treeId?: string, droneMode?: boolean, upscale?: boolean) => {
    setError(null);
    setRunning(video.id);
    try {
      let times: number[];
      if (customTimes && customTimes.trim()) {
        times = customTimes
          .split(/[,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map(parseTimeSpec);
        if (!times.length || times.some((t) => Number.isNaN(t))) {
          throw new Error('時間の指定が正しくありません。例: 00:00:15, 00:01:00');
        }
      } else {
        const dur = video.duration_sec;
        if (dur && dur > 0) {
          const n = Math.min(10, Math.max(1, Math.floor(dur / 1)));
          times = Array.from({ length: n }, (_, i) => (i * dur) / n);
        } else {
          times = [0, 1, 2, 3, 4];
        }
      }
      await api.analyseTimes(video.id, times, soil, treeId, droneMode, upscale);
      setSelected(video.id);
    } catch (e: any) {
      setError(e.message || '解析の開始に失敗しました');
    } finally {
      setRunning(null);
    }
  };

  const runAnalysisWithSoil = (video: Video, custom?: string) =>
    runAnalysis(video, custom, soilInputs[video.id],
      treeIdInputs[video.id]?.trim() || undefined, droneModes[video.id] ?? false,
      upscaleModes[video.id] ?? false);

  const selectVideo = (id: number) => {
    setSelected((cur) => (cur === id ? null : id));
    loadObs(id);
  };

  // API returns newest-first; sort ascending (oldest -> newest) for chart/latest logic.
  const sortedObs = useMemo(() => [...scopedObs].sort((a, b) => a.id - b.id), [scopedObs]);

  const latestState = useMemo<HealthState | null>(() => {
    if (!sortedObs.length) return null;
    return sortedObs[sortedObs.length - 1]?.health_state ?? null;
  }, [sortedObs]);

  // Aggregated state across ALL observations (recency-weighted, from the API),
  // used for the hero card, guidance and KPIs.
  const currentHealth = useMemo<HealthState | null>(
    () => oliveStatus?.current_state ?? null,
    [oliveStatus]
  );

  // KPI: state counts
  const stateCounts = useMemo(() => {
    const c = { happy: 0, good: 0, caution: 0, danger: 0 };
    for (const o of sortedObs) {
      const s = o.health_state?.label;
      if (s && s in c) c[s]++;
    }
    return c;
  }, [sortedObs]);

  const totalNew = sortedObs.length;
  const totalDone = videos.filter((v) => v.status === 'done').length;

  // average score across the scoped observations (for the breakdown footer)
  const avgScore = useMemo(() => {
    const scores = sortedObs
      .map((o) => o.health_state?.score ?? o.overall_health_score)
      .filter((s): s is number => s != null);
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [sortedObs]);

  // days since the latest observation
  const daysSinceLastObs = useMemo(() => {
    if (sortedObs.length === 0) return null;
    const last = new Date(sortedObs[sortedObs.length - 1].observed_at);
    if (Number.isNaN(last.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - last.getTime()) / 86400000));
  }, [sortedObs]);

  const careItems = useMemo(
    () => buildCareItems(currentHealth, daysSinceLastObs, stateCounts),
    [currentHealth, daysSinceLastObs, stateCounts]
  );
  const [doneMap, setDoneMap] = useState<Record<string, boolean>>({});
  const doneCount = careItems.filter((i) => doneMap[i.id]).length;

  // latest observations (newest first) for the side panel
  const latestObs = useMemo(() => [...sortedObs].slice(-5).reverse(), [sortedObs]);

  // video status filter
  const [vFilter, setVFilter] = useState<'all' | Video['status']>('all');
  const shownVideos = useMemo(
    () => (vFilter === 'all' ? videos : videos.filter((v) => v.status === vFilter)),
    [videos, vFilter]
  );

  const videoStatusOrder: { key: 'all' | Video['status']; label: string }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'pending', label: '未解析' },
    { key: 'processing', label: '解析中' },
    { key: 'done', label: '完了' },
    { key: 'error', label: 'エラー' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      {/* page header */}
      <PageHeader
        title="ダッシュボード"
        description="動画をアップロードして、指定した時刻のフレームを自動解析・保存します。"
        actions={
          latestState && sortedObs.length > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-500">
              <span className="h-2 w-2 rounded-full" style={{ background: healthColor(latestState.label) }} />
              <span>
                最終更新{' '}
                <span className="font-medium tabular-nums text-neutral-700">
                  {formatObservedAt(sortedObs[sortedObs.length - 1].observed_at)}
                </span>
              </span>
            </div>
          ) : undefined
        }
      />

      <ErrorNotice message={dataError} onRetry={() => { loadVideos(); loadAllObs(); }} />

      {/* admin: pick which farmer's data to show (never merge all farmers into one trend) */}
      {isAdmin && (
        <section className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-sm font-medium text-neutral-700">表示する農家</span>
          <select
            value={farmerId ?? ''}
            onChange={(e) => setFarmerId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-olive-500 focus:outline-none"
          >
            <option value="" disabled>
              表示する農家を選択
            </option>
            {farmers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.farm_name || f.display_name || f.username}
              </option>
            ))}
          </select>
          {farmerId == null ? (
            <p className="text-xs text-neutral-500">
              農家を選ぶと、その農家の観測のみで推移グラフが表示されます。
            </p>
          ) : (
            <p className="text-xs text-neutral-500">
              {farmers.find((f) => f.id === farmerId)?.farm_name ||
                farmers.find((f) => f.id === farmerId)?.display_name ||
                '選択中の農家'}
              の観測のみで表示しています（農家アカウントと同じ描き方です）。
            </p>
          )}
        </section>
      )}

      {/* current status + action guidance */}
      <section className="card relative mb-6 overflow-hidden">
        {(currentHealth || latestState) && (
          <span
            className="absolute inset-y-0 left-0 w-1"
            style={{ background: healthColor(currentHealth?.label ?? latestState?.label ?? '') }}
          />
        )}
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-neutral-50"
            style={
              currentHealth || latestState
                ? {
                    boxShadow: `inset 0 0 0 2px ${
                      healthColor(currentHealth?.label ?? latestState?.label ?? '') + '33'
                    }`,
                  }
                : undefined
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/characters/${(currentHealth?.label ?? latestState?.label ?? 'good')}.svg`}
              alt="オリーブ"
              className="h-12 w-12"
            />
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-lg font-semibold tracking-tight text-neutral-900 sm:justify-start">
              <span>現在の体調：</span>
              {currentHealth ? (
                <span style={{ color: healthColor(currentHealth.label) }}>
                  {healthJa(currentHealth.label)}
                </span>
              ) : (
                'データなし'
              )}
              <TrendBadge trend={currentHealth?.trend} />
            </p>
            {currentHealth ? (
              <p className="mt-1 text-xs text-neutral-400">
                全 {currentHealth.total_n ?? sortedObs.length} 観測を集計
                （{currentHealth.period_n ?? '—'} メディア）・直近スコア{' '}
                {((currentHealth.latest_score ?? currentHealth.score) * 100).toFixed(1)} 点
                {currentHealth.message ? ` ・ ${currentHealth.message}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-sm text-neutral-500">
                動画や画像をアップロードして「解析を実行」すると、ここに体調の集計結果が表示されます。
              </p>
            )}
          </div>
          {currentHealth && (
            <div className="shrink-0 text-center sm:pr-1">
              <p className="stat-value tabular-nums" style={{ color: healthColor(currentHealth.label) }}>
                {(currentHealth.score * 100).toFixed(0)}
              </p>
              <p className="text-xs text-neutral-400">/ 100 点・集計値</p>
              <HeroMeter score={currentHealth.score} color={healthColor(currentHealth.label)} />
            </div>
          )}
        </div>

        {currentHealth && (
          <div className="mt-5 rounded-xl bg-neutral-50 p-4 ring-1 ring-neutral-100">
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-neutral-500 ring-1 ring-neutral-200">
                <IconSparkle size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="mb-1.5 text-sm font-medium text-neutral-800">今やるべきこと</p>
                <ul className="space-y-1.5 text-sm text-neutral-600">
                  {(currentHealth.advice && currentHealth.advice.length
                    ? currentHealth.advice
                    : [actionGuidance(currentHealth)]
                  ).map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* KPI cards */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<IconFilm size={18} />}
          label="アップロード済み動画"
          value={String(videos.length)}
          sub={totalDone > 0 ? `解析完了 ${totalDone}` : '未解析'}
        />
        <KpiCard
          icon={<IconChart size={18} />}
          label="解析観測点数"
          value={String(totalNew)}
          sub="保存済みの時間フレーム解析"
        />
        <KpiCard
          icon={<IconLeaf size={18} />}
          label="現在の体調（集計）"
          value={currentHealth ? healthJa(currentHealth.label) : latestState ? healthJa(latestState.label) : '—'}
          color={currentHealth ? healthColor(currentHealth.label) : latestState ? healthColor(latestState.label) : undefined}
          sub={
            currentHealth
              ? `集計 ${(currentHealth.score * 100).toFixed(1)} / 直近 ${((currentHealth.latest_score ?? currentHealth.score) * 100).toFixed(1)}`
              : latestState
                ? `スコア ${latestState.score.toFixed(2)}`
                : 'まだデータなし'
          }
        />
        <KpiCard
          icon={<IconActivity size={18} />}
          label="注意・要管理"
          value={String(stateCounts.caution + stateCounts.danger)}
          color={stateCounts.caution + stateCounts.danger > 0 ? '#c25a4a' : undefined}
          sub={`注意 ${stateCounts.caution} / 要管理 ${stateCounts.danger}`}
        />
      </section>

      {/* today's care checklist */}
      <TodayTasks
        items={careItems}
        doneMap={doneMap}
        onToggle={(id) => setDoneMap((prev) => {
          const next = { ...prev };
          if (next[id]) delete next[id];
          else next[id] = true;
          return next;
        })}
        onReset={() => setDoneMap({})}
        doneCount={doneCount}
      />

      {/* Quick actions for farmers */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <QuickAction href="/images" icon={<IconImage size={22} />} label="画像を解析" desc="よく使う機能" />
        <QuickAction href="/olive" icon={<IconOlive size={22} />} label="体調を見る" desc="現在の状態" />
        <QuickAction href="/tracking" icon={<IconChart size={22} />} label="観測記録" desc="履歴を確認" />
        <QuickAction href="/notifications" icon={<IconBell size={22} />} label="お知らせ" desc="未読を確認" />
      </section>

      {/* soil moisture status strip */}
      {soilStatus && (
        <SoilStatusCard status={soilStatus} />
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* left: upload + trend */}
        <div className="space-y-6 lg:col-span-3">
          {/* upload */}
          <section className="card">
            <h2 className="label mb-3">動画を追加</h2>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center transition-colors hover:border-neutral-400 hover:bg-neutral-100/60"
            >
              <IconVideo size={30} className="text-neutral-400" />
              <p className="text-sm font-medium text-neutral-700">
                {uploading ? 'アップロード中…' : 'クリックまたはドラッグして動画を追加'}
              </p>
              <p className="text-xs text-neutral-400">
                複数ファイル対応（MP4 / AVI / MOV / MKV など）
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.avi,.mov,.mkv,.webm,.m4v"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length) handleFiles(files);
                }}
              />
            </div>
            {(uploadError || error) && (
              <ErrorNotice message={uploadError || error} />
            )}
          </section>

          {/* trend */}
          <section className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="label">体調スコアの推移</h2>
                <TrendBadge trend={currentHealth?.trend} />
              </div>
              <span className="text-xs text-neutral-400">
                {sortedObs.length} 時点
              </span>
            </div>
            {sortedObs.length > 0 ? (
              <TrendChart obs={sortedObs} />
            ) : isAdmin && farmerId == null ? (
              <p className="py-8 text-center text-sm text-neutral-400">
                上の「表示する農家」を選択すると、その農家の体調スコアの推移が表示されます。
              </p>
            ) : (
              <p className="py-8 text-center text-sm text-neutral-400">
                「解析を実行」すると、ここに体調スコアの推移が表示されます。
              </p>
            )}
          </section>
        </div>

        {/* right: state distribution */}
        <section className="card self-start lg:col-span-2">
          <h2 className="label mb-4">状態の内訳</h2>
          {sortedObs.length === 0 ? (
            <p className="text-sm text-neutral-400">まだ解析結果がありません。</p>
          ) : (
            <div className="space-y-3">
              {(['happy', 'good', 'caution', 'danger'] as const).map((k) => {
                const count = stateCounts[k];
                const pct = (count / sortedObs.length) * 100;
                return (
                  <div key={k} className="flex items-center gap-3">
                    <StatePill label={healthJa(k)} color={healthColor(k)} />
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: healthColor(k) }}
                      />
                    </div>
                    <span className="w-11 text-right text-sm tabular-nums text-neutral-600">
                      {count}
                      <span className="ml-0.5 text-[11px] text-neutral-400">件</span>
                    </span>
                    <span className="w-9 text-right text-[11px] tabular-nums text-neutral-400">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {sortedObs.length > 0 && (
            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-500">
              <span>合計 {sortedObs.length} 観測</span>
              {avgScore != null && (
                <span className="font-medium tabular-nums text-neutral-700">
                  平均 {avgScore * 100 >= 10 ? (avgScore * 100).toFixed(1) : avgScore.toFixed(3)} 点
                </span>
              )}
            </div>
          )}

          {latestObs.length > 0 && (
            <div className="mt-6 border-t border-neutral-100 pt-4">
              <div className="section-head">
                <h2 className="label">直近の観測</h2>
                <a href="/tracking" className="text-[11px] text-neutral-500 hover:text-neutral-800">
                  すべて見る
                </a>
              </div>
              <ul className="space-y-2.5">
                {latestObs.map((o) => {
                  const sc = o.health_state?.score ?? o.overall_health_score;
                  return (
                    <li key={o.id} className="flex items-center gap-3">
                      <StatePill
                        label={healthJa(o.health_state?.label ?? '—')}
                        color={healthColor(o.health_state?.label ?? '')}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-neutral-500">
                          {o.filename || `観測 #${o.id}`}
                        </p>
                        <p className="text-[11px] text-neutral-400">{formatMeasuredAt(o.observed_at)}</p>
                      </div>
                      <span className="tabular-nums text-sm font-semibold text-neutral-800">
                        {sc != null ? (sc * 100).toFixed(0) : '—'}
                        <span className="text-[10px] font-normal text-neutral-400"> 点</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* video list */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="label">アップロード済みの動画</h2>
            <span className="badge bg-neutral-100 text-neutral-600">{videos.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {videoStatusOrder.map((f) => (
              <button
                key={f.key}
                onClick={() => setVFilter(f.key)}
                className={`badge transition-colors ${
                  vFilter === f.key
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {shownVideos.length === 0 ? (
          <div className="card text-center text-sm text-neutral-400">
            {videos.length === 0
              ? 'まだ動画がありません。上の領域から動画を追加してください。'
              : `「${videoStatusOrder.find((f) => f.key === vFilter)?.label}」の動画はありません。`}
          </div>
        ) : (
          <div className="space-y-3">
            {shownVideos.map((v) => (
              <div key={v.id} className="card">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <button
                    onClick={() => selectVideo(v.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600">
                      <IconFilm size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-neutral-800">
                        {v.filename}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-neutral-400">
                        <span>{formatBytes(v.size_bytes)}</span>
                        <span>長さ {formatDuration(v.duration_sec)}</span>
                        {v.width && v.height && <span>{v.width}×{v.height}</span>}
                        {v.recorded_at && <span>撮影 {formatMeasuredAt(v.recorded_at)}</span>}
                      </span>
                    </span>
                  </button>
                  <StatusBadge status={v.status} />
                  <button
                    onClick={() => runAnalysisWithSoil(v, timeSpec[v.id])}
                    disabled={v.status === 'processing' || running === v.id}
                    className="btn-primary"
                  >
                    {running === v.id ? '開始中…' : '解析を実行'}
                  </button>
                </div>

                {selected === v.id && (
                  <div className="mt-4 border-t border-neutral-100 pt-4">
                    <AnalyseControls
                      video={v}
                      timeSpec={timeSpec[v.id] || ''}
                      onTimeChange={(val) => setTimeSpec((prev) => ({ ...prev, [v.id]: val }))}
                      onRun={(custom) => runAnalysisWithSoil(v, custom)}
                      running={running === v.id}
                      soil={soilInputs[v.id]}
                      onSoilChange={(val) => setSoilInputs((prev) => ({ ...prev, [v.id]: val }))}
                      treeId={treeIdInputs[v.id] || ''}
                      onTreeIdChange={(val) => setTreeIdInputs((prev) => ({ ...prev, [v.id]: val }))}
                      droneMode={droneModes[v.id] ?? false}
                      onDroneModeChange={(val) => setDroneModes((prev) => ({ ...prev, [v.id]: val }))}
                      upscale={upscaleModes[v.id] ?? false}
                      onUpscaleChange={(val) => setUpscaleModes((prev) => ({ ...prev, [v.id]: val }))}
                    />
                    <div className="mt-4">
                      <ObservationTable obs={obsByVideo[v.id] || []} error={obsErrors[v.id]} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card card-hover flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <p className="stat-label">{label}</p>
        {icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600">
            {icon}
          </span>
        )}
      </div>
      <p
        className="mt-2 stat-value"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}

function TrendBadge({ trend }: { trend?: string | null }) {
  if (trend === 'up') {
    return <span className="badge bg-health-good/10 text-health-good">↑ 回復傾向</span>;
  }
  if (trend === 'down') {
    return <span className="badge bg-health-danger/10 text-health-danger">↓ 低下傾向</span>;
  }
  if (trend === 'flat') {
    return <span className="badge bg-neutral-100 text-neutral-600">→ 安定</span>;
  }
  return null;
}

/** Compact score meter for the hero: threshold ticks + state-colored fill. */
function HeroMeter({ score, color }: { score: number; color: string }) {
  const pct = Math.max(0, Math.min(100, score * 100));
  return (
    <div className="mx-auto mt-2 w-28">
      <div className="relative h-2 w-full rounded-full bg-neutral-200/70">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color, opacity: 0.35 }}
        />
        {[35, 55, 75].map((t) => (
          <div key={t} className="absolute top-0 h-full w-px bg-white/90" style={{ left: `${t}%` }} />
        ))}
        <div
          className="absolute top-1/2 h-3 w-1.5 -translate-y-1/2 rounded-full shadow ring-1 ring-white transition-[left] duration-500"
          style={{ left: `calc(${pct}% - 3px)`, background: color }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-neutral-400">
        <span>要管理</span>
        <span>健康</span>
      </div>
    </div>
  );
}

/** Derive today's suggested actions from the aggregated health + recency. */
function buildCareItems(
  cur: HealthState | null,
  daysSince: number | null,
  counts: { caution: number; danger: number }
): { id: string; label: string; hint?: string }[] {
  const items: { id: string; label: string; hint?: string }[] = [];
  if (cur?.label === 'danger') {
    items.push({ id: 'urgent', label: '要管理の株を早めに対応', hint: '灌水・剪定を優先してください' });
  }
  if (cur != null && cur.water_stress != null && cur.water_stress > 0.5) {
    items.push({ id: 'water', label: '灌水する', hint: `水分ストレス ${Math.round(cur.water_stress * 100)}% と高めです` });
  }
  if ((cur?.wrinkled_fruit_count ?? 0) > 0) {
    items.push({ id: 'fruit', label: '果実の確認・摘果', hint: `しわ果 ${cur?.wrinkled_fruit_count} 個を検出` });
  }
  if (cur?.trend === 'down') {
    items.push({ id: 'watch', label: '低下傾向のため注視', hint: '回復に転じるまで観察を続けてください' });
  }
  if (counts.danger > 0) {
    items.push({ id: 'danger', label: '要管理エリアの確認', hint: `${counts.danger} 件の要注意観測があります` });
  }
  if (daysSince != null && daysSince >= 3) {
    items.push({ id: 'analyze', label: '新しい動画・画像の解析', hint: `前回の観測から ${daysSince} 日` });
  }
  if (items.length === 0) {
    items.push({ id: 'observe', label: 'このまま観察を続ける', hint: '特に緊急の作業はありません' });
  }
  return items.slice(0, 5);
}

function TodayTasks({
  items,
  doneMap,
  onToggle,
  onReset,
  doneCount,
}: {
  items: { id: string; label: string; hint?: string }[];
  doneMap: Record<string, boolean>;
  onToggle: (id: string) => void;
  onReset: () => void;
  doneCount: number;
}) {
  return (
    <section className="card mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="label">今日のお手入れ</h2>
          <span className="badge bg-neutral-100 text-neutral-600">
            {doneCount} / {items.length} 済み
          </span>
        </div>
        <button onClick={onReset} disabled={doneCount === 0} className="btn-ghost btn-sm">
          リセット
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400">観測データがありません。</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <label
              key={item.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                doneMap[item.id] ? 'border-neutral-100 bg-neutral-50' : 'border-neutral-200 bg-white hover:border-neutral-400'
              }`}
            >
              <input
                type="checkbox"
                checked={!!doneMap[item.id]}
                onChange={() => onToggle(item.id)}
                className="mt-0.5 h-4 w-4 accent-neutral-900"
              />
              <span className="min-w-0">
                <span className={`block font-medium ${doneMap[item.id] ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>
                  {item.label}
                </span>
                {item.hint && (
                  <span className="mt-0.5 block text-xs text-neutral-400">{item.hint}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function QuickAction({
  href,
  icon,
  label,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-700 transition-colors group-hover:bg-neutral-900 group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-800">{label}</span>
        <span className="block text-[11px] text-neutral-400">{desc}</span>
      </span>
      <IconChevronRight
        size={16}
        className="shrink-0 text-neutral-300 transition-all group-hover:translate-x-0.5 group-hover:text-neutral-500"
      />
    </a>
  );
}

function SoilStatusCard({ status }: { status: SoilStatus }) {
  const sm = status.soil_moisture || {};
  const h = status.health;
  const source =
    status.source === 'api'
      ? { label: '自動取得', cls: 'bg-health-good/10 text-health-good' }
      : status.source === 'manual'
      ? { label: '手動入力', cls: 'bg-olive-50 text-olive-700' }
      : status.source === 'error'
      ? { label: 'APIエラー', cls: 'bg-health-danger/10 text-health-danger' }
      : { label: '未設定', cls: 'bg-neutral-100 text-neutral-500' };
  const measured = sm.measured_at ? formatMeasuredAt(sm.measured_at) : null;

  const ageH = status.data_age_hours;
  const stale = ageH != null && ageH >= 6;
  const veryStale = ageH != null && ageH >= 24;

  return (
    <section className={`card mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 ${veryStale ? 'border-health-danger/40' : stale ? 'border-health-caution/40' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-neutral-100 text-neutral-600">
          <IconDroplet size={20} />
        </span>
        <div>
          <p className="stat-label">土壌水分・環境</p>
          <div className="flex items-center gap-2">
            <span className={`badge ${source.cls}`}>{source.label}</span>
            {measured && <span className="text-[11px] text-neutral-400">{measured}ごろ</span>}
            {status.sensor_online === false && status.source === 'api' && (
              <span className="badge bg-health-danger/10 text-health-danger text-[11px]">
                センサー停止中
              </span>
            )}
          </div>
        </div>
      </div>
      <Metric label="センサー1" value={sm.sensor1_moisture_percent != null ? `${sm.sensor1_moisture_percent}%` : '—'} />
      <Metric label="センサー2" value={sm.sensor2_moisture_percent != null ? `${sm.sensor2_moisture_percent}%` : '—'} />
      <Metric label="気温" value={sm.temperature != null ? `${sm.temperature}°C` : '—'} />
      <Metric label="湿度" value={sm.humidity != null ? `${sm.humidity}%` : '—'} />
      {h?.message && (
        <div className="ml-auto text-sm text-neutral-600">
          <span className="text-xs text-neutral-400">判定: </span>
          {h.message}
        </div>
      )}
      {stale && (
        <div className="w-full mt-1 rounded-lg px-3 py-2 text-xs bg-health-caution/10 text-health-caution">
          データが{ageH != null ? `${Math.round(ageH)}時間` : ''}前に更新されています。センサーがオフラインの可能性があります。
          {veryStale && ' 物理的な確認をお勧めします。'}
        </div>
      )}
      {status.error && (
        <div className="w-full mt-1 rounded-lg px-3 py-2 text-xs bg-health-danger/10 text-health-danger">
          API エラー: {status.error}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-neutral-400">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-neutral-800">{value}</p>
    </div>
  );
}

function AnalyseControls({
  video,
  timeSpec,
  onTimeChange,
  onRun,
  running,
  soil,
  onSoilChange,
  treeId,
  onTreeIdChange,
  droneMode,
  onDroneModeChange,
  upscale,
  onUpscaleChange,
}: {
  video: Video;
  timeSpec: string;
  onTimeChange: (val: string) => void;
  onRun: (custom?: string) => void;
  running: boolean;
  soil?: SoilMoistureInput;
  onSoilChange: (val: SoilMoistureInput | undefined) => void;
  treeId?: string;
  onTreeIdChange: (val: string) => void;
  droneMode?: boolean;
  onDroneModeChange: (val: boolean) => void;
  upscale?: boolean;
  onUpscaleChange: (val: boolean) => void;
}) {
  const defaultHint =
    video.duration_sec && video.duration_sec > 0
      ? `動画の長さ ${formatDuration(video.duration_sec)}。未指定なら全体を自動サンプリングします。`
      : '時間を指定してください（例: 00:00:15, 00:01:00）';
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-neutral-50 p-4">
        <p className="mb-2 text-sm font-medium text-neutral-700">
          解析する時間を指定（秒または MM:SS / HH:MM:SS、カンマ区切り）
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={timeSpec}
            onChange={(e) => onTimeChange(e.target.value)}
            placeholder="例: 00:00:15, 00:01:00, 90"
            className="input flex-1"
          />
          <div className="flex items-center gap-2">
            <button onClick={() => onRun()} disabled={running} className="btn-secondary">
              自動サンプリング
            </button>
            <button onClick={() => onRun(timeSpec)} disabled={running} className="btn-primary">
              {running ? '解析中…' : 'この時間で解析'}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-neutral-400">{defaultHint}</p>
      </div>
      <div className="mt-2.5 space-y-2">
          <input
            type="text"
            value={treeId}
            onChange={(e) => onTreeIdChange(e.target.value)}
            placeholder="樹木ID（例: 第3試験樹・空欄でQR自動認識）"
            className="input w-full"
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-neutral-600">
            <input
              type="checkbox"
              checked={droneMode ?? false}
              onChange={(e) => {
                onDroneModeChange(e.target.checked);
                // Drone/aerial input is low-res: automatically enable AI upscaling,
                // matching olive-p's behaviour.
                if (e.target.checked && !upscale) onUpscaleChange(true);
              }}
              className="h-4 w-4 rounded accent-olive-600"
            />
            ドローン撮影（低解像度・上空からの動画）
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2.5 transition-colors hover:bg-violet-50">
            <input
              type="checkbox"
              checked={upscale ?? false}
              onChange={(e) => onUpscaleChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-violet-600"
            />
            <span>
              <span className="font-semibold text-violet-800">AI高解像度解析（x4）</span>
              <span className="mt-0.5 block text-[10px] leading-snug text-violet-600">
                低解像度のフレームをAIで4倍に高画質化してから解析します。高解像度でも精度よく検出できます（処理時間がかかります）。
              </span>
            </span>
          </label>
        </div>
        <SoilInputPanel onChange={onSoilChange} />
      {soil && (
        <p className="text-xs text-neutral-500">
          土壌水分データを添付して解析します。
        </p>
      )}
    </div>
  );
}

function ObservationTable({ obs, error }: { obs: Observation[]; error?: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (error) {
    return (
      <p className="rounded-md bg-health-danger/10 px-3 py-2 text-sm text-health-danger">
        {error}
      </p>
    );
  }

  if (obs.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        まだ解析結果がありません。「解析を実行」すると、指定した時間のフレームがここに表示されます。
      </p>
    );
  }

  // Group by timestamp_sec (+ tree_id) so comparison rows don't duplicate.
  // Each group has a "primary" display row and an optional "comparison" obs.
  interface RowGroup {
    key: string;
    primary: Observation;
    comparison: Observation | null;
    timestamp_sec: number;
  }

  const groups: RowGroup[] = [];
  const seen = new Set<string>();
  for (const o of obs) {
    const tsKey = `${o.timestamp_sec}_${o.tree_id ?? ''}`;
    if (seen.has(tsKey)) continue;
    seen.add(tsKey);
    const pair = obs.find(
      (other) =>
        other.id !== o.id &&
        other.timestamp_sec === o.timestamp_sec &&
        other.tree_id === o.tree_id &&
        other.upscaled !== o.upscaled,
    );
    // Prefer upscaled as primary if both exist
    let primary: Observation;
    let comparison: Observation | null = null;
    if (pair) {
      if (o.upscaled) {
        primary = o;
        comparison = pair;
      } else {
        primary = pair;
        comparison = o;
      }
    } else {
      primary = o;
    }
    groups.push({ key: tsKey, primary: primary!, comparison, timestamp_sec: o.timestamp_sec });
  }

  return (
    <div>
      <h3 className="label mb-2">解析結果（{groups.length} フレーム）</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-400">
              <th className="pb-2 pr-4 font-medium">時間</th>
              <th className="pb-2 pr-4 font-medium">葉数</th>
              <th className="pb-2 pr-4 font-medium">果実</th>
              <th className="pb-2 pr-4 font-medium">緑被率</th>
              <th className="pb-2 pr-4 font-medium">体調</th>
              <th className="pb-2 pr-4 font-medium">解析画像</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const o = g.primary;
              const st = o.health_state;
              const isOpen = expanded === g.key;
              return (
                <div key={g.key}>
                  <tr className={isOpen ? 'border-t border-neutral-100 bg-neutral-50' : 'border-t border-neutral-100 hover:bg-neutral-50/60'}>
                    <td className="py-2.5 pr-4 font-medium tabular-nums text-neutral-700">
                      {formatTimestamp(o.timestamp_sec)}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{o.leaf_count ?? '—'}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{o.fruit_count ?? '—'}</td>
                    <td className="py-2.5 pr-4 tabular-nums">
                      {o.green_coverage != null ? `${o.green_coverage.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      {st ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: healthColor(st.label) }} />
                          <span className="text-neutral-700">{healthJa(st.label)}</span>
                          <span className="text-xs tabular-nums text-neutral-400">{st.score.toFixed(2)}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      {o.annotated_path ? <FrameThumb obs={o} /> : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {o.upscaled && <UpscaledBadge model={o.upscale_model} />}
                        <button
                          onClick={() => setExpanded(isOpen ? null : g.key)}
                          className="text-sm text-olive-700 hover:underline"
                        >
                          {isOpen ? '閉じる' : '詳細'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-neutral-100 bg-neutral-50">
                      <td colSpan={7} className="py-4">
                        <ObservationDetail obs={o} />
                      </td>
                    </tr>
                  )}
                </div>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FrameThumb({ obs }: { obs: Observation }) {
  const url = (obs.result?.['_frame_annotated_url'] as string) || null;
  if (!url) return <span className="text-neutral-300">—</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="解析画像" className="h-11 w-20 rounded-md object-cover ring-1 ring-neutral-200" />
  );
}

function ObservationDetail({ obs }: { obs: Observation }) {
  const r = obs.result || {};
  const st = obs.health_state;
  const details = r.analysis_details;
  const stress = details?.stress || {};
  const annotatedUrl = (r['_frame_annotated_url'] as string) || null;
  const rawUrl = (r['_frame_raw_url'] as string) || null;
  const soil = r.soil_moisture as SoilMoistureData | undefined;
  const soilSource = r.soil_source as string | undefined;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        {obs.upscaled && (
          <div className="mb-3"><UpscaledBadge model={obs.upscale_model} large /></div>
        )}
        {st && (
          <div className="mb-3 rounded-lg border p-3 text-sm" style={{ borderColor: `${healthColor(st.label)}33`, background: `${healthColor(st.label)}0d` }}>
            <p className="font-medium" style={{ color: healthColor(st.label) }}>
              {healthJa(st.label)} · スコア {st.score.toFixed(3)}
            </p>
            <p className="mt-1 text-neutral-700">{st.message}</p>
            {st.details && <p className="mt-1 text-xs text-neutral-500">{st.details}</p>}
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2.5 text-sm">
          <DetailItem label="葉数" value={String(obs.leaf_count ?? '—')} />
          <DetailItem label="果実" value={String(obs.fruit_count ?? '—')} />
          <DetailItem label="緑被率" value={obs.green_coverage != null ? `${obs.green_coverage.toFixed(1)}%` : '—'} />
          <DetailItem label="水分ストレス" value={stress.water_stress != null ? stress.water_stress.toFixed(3) : '—'} />
          <DetailItem label="葉カール指数" value={obs.leaf_curl_index != null ? obs.leaf_curl_index.toFixed(3) : '—'} />
          <DetailItem label="成熟度" value={r.fruit_maturity || '—'} />
          <DetailItem label="葉ステージ" value={r.leaf_color_stage || '—'} />
          <DetailItem label="しわ果" value={String(obs.wrinkled_fruit_count ?? 0)} />
          <DetailItem label="全体健康スコア" value={stress.overall_health_score != null ? stress.overall_health_score.toFixed(3) : '—'} />
          <DetailItem label="クロロフィル" value={stress.chlorophyll_proxy != null ? stress.chlorophyll_proxy.toFixed(3) : '—'} />
        </dl>
        <div className="mt-3">
          <p className="label mb-1.5">土壌水分・環境</p>
          <SoilDisplay source={soilSource} soil={soil} />
        </div>
      </div>
      <div className="space-y-2">
        {annotatedUrl && (
          <div>
            <p className="label mb-1">解析済み画像</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={annotatedUrl} alt="解析済み" className="w-full rounded-lg ring-1 ring-neutral-200" />
          </div>
        )}
        {rawUrl && (
          <a href={rawUrl} target="_blank" rel="noreferrer" className="text-sm text-olive-700 underline">
            元フレームを開く
          </a>
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-neutral-800">{value}</dd>
    </div>
  );
}

function parseTimeSpec(spec: string): number {
  const text = spec.trim();
  if (!text) return NaN;
  if (text.includes(':')) {
    const parts = text.split(':').map((p) => parseFloat(p));
    if (parts.some((p) => Number.isNaN(p))) return NaN;
    let secs = 0;
    for (const p of parts) secs = secs * 60 + p;
    return secs;
  }
  const s = parseFloat(text);
  return Number.isNaN(s) ? NaN : s;
}

function formatMeasuredAt(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return null;
  }
}

function formatObservedAt(iso?: string | null): string {
  return formatMeasuredAt(iso) ?? '—';
}
