'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, CalendarData, CalendarObservation, HealthState, FarmerRecord } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { healthJa, healthColor, STATE_ORDER, scoreColor } from '@/components/charts';
import { IconChevronRight } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import ErrorNotice from '@/components/ErrorNotice';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
type ViewMode = 'month' | 'week';
type StateFilter = 'all' | (typeof STATE_ORDER)[number];

export default function CalendarPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<CalendarData | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [farmers, setFarmers] = useState<FarmerRecord[]>([]);
  const [farmerId, setFarmerId] = useState<number | null>(null);
  // reference week (Mon..Sun) for week view
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today));

  // load farmers for admin selector
  useEffect(() => {
    if (isAdmin) api.listFarmers().then(setFarmers).catch(() => {});
  }, [isAdmin]);

  const load = useCallback(async (y: number, m: number, fid: number | null) => {
    setLoading(true);
    try {
      const d = await api.calendar(y, m, fid ?? undefined);
      setData(d);
      const todayKey = `${y}-${String(m).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const inRange =
        today.getFullYear() === y && today.getMonth() + 1 === m && d.observations[todayKey];
      setSelectedDate((prev) =>
        prev && (prev.startsWith(`${y}-${String(m).padStart(2, '0')}`))
          ? prev
          : inRange
          ? todayKey
          : null
      );
      setError(null);
    } catch (e: any) {
      setError(e.message || 'カレンダーの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    load(viewYear, viewMonth, farmerId);
  }, [load, viewYear, viewMonth, farmerId]);

  const todayKey = useMemo(
    () => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
    [today]
  );

  const cellCount = useMemo(() => {
    const first = new Date(viewYear, viewMonth - 1, 1);
    return { startOffset: first.getDay(), daysInMonth: new Date(viewYear, viewMonth, 0).getDate() };
  }, [viewYear, viewMonth]);

  // ---- derived stats ----
  const allObs = useMemo<CalendarObservation[]>(() => {
    if (!data) return [];
    return Object.values(data.observations).flat();
  }, [data]);

  const avgScore = useMemo(() => {
    const scores = allObs
      .map((o) => o.health_state?.score ?? o.overall_health_score)
      .filter((v): v is number => v != null);
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [allObs]);

  const stateCounts = useMemo(() => {
    const c: Record<string, number> = { happy: 0, good: 0, caution: 0, danger: 0 };
    for (const o of allObs) {
      const s = o.health_state?.label;
      if (s && s in c) c[s]++;
    }
    return c;
  }, [allObs]);

  const daily = useMemo(() => {
    const map: Record<string, { state: HealthState | null; score: number | null; count: number }> = {};
    for (const [date, obs] of Object.entries(data?.observations ?? {})) {
      const scores = obs
        .map((o) => o.health_state?.score ?? o.overall_health_score)
        .filter((v): v is number => v != null);
      const states = obs.map((o) => o.health_state).filter((v): v is HealthState => !!v);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      map[date] = {
        state: states.length ? states[states.length - 1] : null,
        score: avg,
        count: obs.length,
      };
    }
    return map;
  }, [data]);

  // ---- month grid building ----
  const dateKey = (y: number, m: number, day: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const monthCells = useMemo(() => {
    const cells: (number | null)[] = [];
    for (let i = 0; i < cellCount.startOffset; i++) cells.push(null);
    for (let d = 1; d <= cellCount.daysInMonth; d++) cells.push(d);
    return cells;
  }, [cellCount]);

  // ---- week view ----
  const weekDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  const weekLabel = useMemo(() => {
    if (weekDays[0].getFullYear() === weekDays[6].getFullYear()) {
      return `${weekDays[0].getFullYear()}年 ${weekDays[0].getMonth() + 1}/${weekDays[0].getDate()} - ${weekDays[6].getMonth() + 1}/${weekDays[6].getDate()}`;
    }
    return `${weekDays[0].getFullYear()}/${weekDays[0].getMonth() + 1}/${weekDays[0].getDate()} - ${weekDays[6].getFullYear()}/${weekDays[6].getMonth() + 1}/${weekDays[6].getDate()}`;
  }, [weekDays]);

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + delta * 7);
    setWeekStart(d);
  };

  const monthLabel = `${viewYear}年 ${viewMonth}月`;

  const goToday = () => {
    if (viewMode === 'month') {
      setViewYear(today.getFullYear());
      setViewMonth(today.getMonth() + 1);
    } else {
      setWeekStart(startOfWeek(today));
    }
    setSelectedDate(todayKey);
  };

  const prevMonth = () => {
    let m = viewMonth - 1, y = viewYear;
    if (m < 1) { m = 12; y--; }
    setViewMonth(m); setViewYear(y);
  };
  const nextMonth = () => {
    let m = viewMonth + 1, y = viewYear;
    if (m > 12) { m = 1; y++; }
    setViewMonth(m); setViewYear(y);
  };

  const isDateFiltered = (date: string) => {
    if (stateFilter === 'all') return true;
    const d = daily[date];
    return !!d?.state && d.state.label === stateFilter;
  };

  const filteredDaily = useMemo(() => {
    const out: Record<string, typeof daily[string]> = {};
    for (const [date, d] of Object.entries(daily)) {
      if (stateFilter === 'all' || (d.state && d.state.label === stateFilter)) out[date] = d;
    }
    return out;
  }, [daily, stateFilter]);

  const selectedObs = selectedDate ? data?.observations[selectedDate] ?? [] : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <PageHeader
        title="観測カレンダー"
        description="解析した日の体調を日付ごとに確認できます。スコアの濃淡で推移がひと目でわかります。"
        actions={
          <>
            <div className="flex overflow-hidden rounded-lg border border-neutral-200">
              <button
                onClick={() => setViewMode('month')}
                className={`px-3 py-1.5 text-xs font-medium ${viewMode === 'month' ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
              >
                月間
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`px-3 py-1.5 text-xs font-medium ${viewMode === 'week' ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
              >
                週間
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={goToday} className="btn-ghost btn-sm">今日</button>
              <button onClick={viewMode === 'month' ? prevMonth : () => shiftWeek(-1)} className="btn-ghost btn-sm">‹</button>
              <span className="min-w-32 text-center text-sm font-medium text-neutral-800">
                {viewMode === 'month' ? monthLabel : weekLabel}
              </span>
              <button onClick={viewMode === 'month' ? nextMonth : () => shiftWeek(1)} className="btn-ghost btn-sm">›</button>
            </div>
          </>
        }
      />

      {/* Controls: farmer switch (admin) + state filter */}
      {(isAdmin || stateFilter !== 'all') && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {isAdmin && (
            <select
              value={farmerId ?? ''}
              onChange={(e) => setFarmerId(e.target.value === '' ? null : Number(e.target.value))}
              className="input rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">全農家</option>
              {farmers.map((f) => (
                <option key={f.id} value={f.id}>{f.farm_name || f.display_name || f.username}</option>
              ))}
            </select>
          )}
          {/* state filter chips */}
          <div className="flex flex-wrap gap-1.5">
            <StateChip active={stateFilter === 'all'} onClick={() => setStateFilter('all')} label="すべて" count={allObs.length} />
            {STATE_ORDER.map((k) => (
              <StateChip
                key={k}
                active={stateFilter === k}
                onClick={() => setStateFilter(stateFilter === k ? 'all' : k)}
                label={healthJa(k)}
                count={stateCounts[k]}
                color={healthColor(k)}
              />
            ))}
          </div>
        </div>
      )}

      {error && <ErrorNotice message={error} onRetry={() => load(viewYear, viewMonth, farmerId)} />}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: calendar */}
        <section className="card lg:col-span-2">
          {/* Monthly summary */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryBox label="観測数" value={String(allObs.length)} />
            <SummaryBox
              label="平均スコア"
              value={avgScore != null ? String((avgScore * 100).toFixed(0)) : '—'}
              unit="点"
              color={avgScore != null ? scoreColor(avgScore) : undefined}
            />
            <SummaryBox label="健康・良好" value={String(stateCounts.happy + stateCounts.good)} color={healthColor('happy')} />
            <SummaryBox label="注意・要管理" value={String(stateCounts.caution + stateCounts.danger)} color={healthColor('danger')} />
          </div>

          <div className="mb-3 flex items-center gap-4 text-[11px] text-neutral-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: healthColor('happy') }} />健康</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: healthColor('good') }} />良好</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: healthColor('caution') }} />注意</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: healthColor('danger') }} />要管理</span>
          </div>

          {loading ? (
            <p className="py-16 text-center text-sm text-neutral-400">読み込み中…</p>
          ) : viewMode === 'month' ? (
            <div>
              <div className="mb-1.5 grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((w, i) => (
                  <div key={w} className={`text-center text-[11px] font-medium ${i === 0 || i === 6 ? 'text-neutral-400' : 'text-neutral-500'}`}>{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {monthCells.map((day, idx) => {
                  if (day === null) return <div key={`e${idx}`} className="min-h-14 rounded-lg border border-transparent" />;
                  const key = dateKey(viewYear, viewMonth, day);
                  const d = daily[key];
                  const isToday = key === todayKey;
                  const selected = selectedDate === key;
                  const showDay = isDateFiltered(key) && !!d;
                  const filteredOut = !!d && stateFilter !== 'all' && !showDay;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDate(selected ? null : key)}
                      title={showDay && d ? cellTitle(d) : undefined}
                      className={`group relative flex min-h-14 flex-col rounded-lg border p-1.5 text-left transition-colors ${
                        selected ? 'border-neutral-800 shadow-sm' : filteredOut ? 'border-neutral-100 bg-neutral-50 opacity-40' : d ? 'border-neutral-200 bg-white hover:border-neutral-400' : 'border-neutral-100 bg-neutral-50'
                      }`}
                      style={d && showDay ? { background: heatBg(d.score) } : undefined}
                    >
                      <span className={`text-xs font-medium ${selected ? 'text-white' : isToday ? 'text-neutral-900' : d && showDay ? 'text-neutral-700' : 'text-neutral-400'}`}>
                        {day}
                        {isToday && <span className="ml-1 text-[9px] font-bold">今日</span>}
                      </span>
                      {showDay && d && (
                        <span className="mt-auto flex items-center justify-between">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.state ? healthColor(d.state.label) : scoreColor(d.score ?? 0) }} />
                          <span className={`text-[10px] font-bold tabular-nums ${selected ? 'text-white' : 'text-neutral-700'}`}>
                            {d.score != null ? (d.score * 100).toFixed(0) : '—'}
                          </span>
                        </span>
                      )}
                      {showDay && d && (
                        <span className={`mt-0.5 text-[9px] tabular-nums ${selected ? 'text-neutral-200' : 'text-neutral-400'}`}>
                          {d.count}件
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            // Week view
            <div>
              <div className="mb-1.5 grid grid-cols-7 gap-1">
                {weekDays.map((d, i) => {
                  const isToday = d.toDateString() === today.toDateString();
                  return (
                    <div key={i} className={`text-center ${i === 0 || i === 6 ? 'text-neutral-400' : 'text-neutral-500'}`}>
                      <div className="text-[11px] font-medium">{WEEKDAYS[i]}</div>
                      {isToday ? (
                        <span className="mx-auto mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-neutral-900 text-[10px] font-bold text-white">
                          {d.getDate()}
                        </span>
                      ) : (
                        <div className="mt-0.5 text-[10px] tabular-nums text-neutral-400">{d.getDate()}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {weekDays.map((day) => {
                  const key = dateKey(day.getFullYear(), day.getMonth() + 1, day.getDate());
                  const d = daily[key];
                  const isToday = key === todayKey;
                  const selected = selectedDate === key;
                  const inCurrentMonth = day.getFullYear() === viewYear && day.getMonth() + 1 === viewMonth;
                  const showDay = isDateFiltered(key) && !!d;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDate(selected ? null : key)}
                      title={showDay && d ? cellTitle(d) : undefined}
                      className={`relative flex min-h-28 flex-col rounded-lg border p-1.5 text-left transition-colors ${
                        selected ? 'border-neutral-800 shadow-sm' : d ? 'border-neutral-200 bg-white hover:border-neutral-400' : 'border-neutral-100 bg-neutral-50'
                      } ${!inCurrentMonth ? 'opacity-50' : ''}`}
                      style={d && showDay ? { background: heatBg(d.score) } : undefined}
                    >
                      <span className={`text-xs font-medium ${selected ? 'text-white' : isToday ? 'text-neutral-900' : 'text-neutral-600'}`}>
                        {day.getDate()}
                        {isToday && <span className="ml-1 text-[9px] font-bold">今</span>}
                      </span>
                      {showDay && d && (
                        <div className="mt-1 flex items-center justify-between px-0.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.state ? healthColor(d.state.label) : scoreColor(d.score ?? 0) }} />
                          <span className={`text-xs font-bold tabular-nums ${selected ? 'text-white' : 'text-neutral-800'}`}>
                            {d.score != null ? (d.score * 100).toFixed(0) : '—'}
                          </span>
                        </div>
                      )}
                      {showDay && d && (
                        <span className={`mt-auto text-[10px] tabular-nums ${selected ? 'text-neutral-200' : 'text-neutral-500'}`}>
                          {d.count}件
                        </span>
                      )}
                      {!d && <span className="mt-auto text-[10px] text-neutral-300">—</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Right: selected date details */}
        <section className="card self-start">
          <h2 className="label mb-3">
            {selectedDate ? `${selectedDate.slice(0, 4)}年${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8, 10))}日` : '日付を選択'}
          </h2>
          {!selectedDate ? (
            <p className="text-sm text-neutral-400">カレンダーの日付をクリックすると、その日の観測結果が表示されます。</p>
          ) : selectedObs.length === 0 ? (
            <p className="text-sm text-neutral-400">この日の観測データはありません。</p>
          ) : (
            <>
              {/* day summary */}
              {daily[selectedDate] && (
                <div className="mb-3 flex items-center gap-3 rounded-lg bg-neutral-50 p-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold"
                    style={{ background: daily[selectedDate].state ? healthColor(daily[selectedDate].state!.label) : scoreColor(daily[selectedDate].score ?? 0), color: '#fff' }}>
                    {daily[selectedDate].score != null ? (daily[selectedDate].score * 100).toFixed(0) : '—'}
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-neutral-800">
                      {daily[selectedDate].state ? healthJa(daily[selectedDate].state.label) : 'データあり'}
                    </div>
                    <div className="text-xs text-neutral-500">{daily[selectedDate].count}件の観測</div>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {selectedObs.map((o) => (
                  <div key={o.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.health_state ? healthColor(o.health_state.label) : '#a0a0a0' }} />
                      <span className="text-sm font-medium text-neutral-800">
                        {o.health_state ? healthJa(o.health_state.label) : '—'}
                      </span>
                      <span className="ml-auto text-xs tabular-nums text-neutral-500">
                        {o.health_state?.score?.toFixed(2) ?? o.overall_health_score?.toFixed(2) ?? '—'}
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                      <span>葉: {o.leaf_count ?? '—'} </span>
                      <span>果実: {o.fruit_count ?? '—'}</span>
                      <span className="col-span-2 truncate">{o.source ?? '—'}</span>
                      <span className="col-span-2 text-[11px] text-neutral-400">
                        {o.farm_name ? `${o.farm_name} · ` : ''}{timeOf(o.observed_at)}
                      </span>
                    </div>
                    <Link href={o.label === 'image' ? '/images' : '/tracking'} className="mt-2 inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-800">
                      詳細を見る <IconChevronRight size={12} />
                    </Link>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Native hover tooltip for calendar cells. */
function cellTitle(d: { score: number | null; count: number } | undefined): string {
  if (!d) return '';
  const score = d.score != null ? (d.score * 100).toFixed(1) : '—';
  return `平均スコア ${score}点・${d.count}件`;
}

/** Heat-map background: interpolate between white and the state color by score. */
function heatBg(score: number | null): string {
  if (score == null) return '#fafafa';
  const c = scoreColor(score);
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  // intensity stronger as score moves away from middle; use absolute saturation
  const t = 0.12 + Math.abs(score - 0.5) * 0.6; // 0.12..~0.42
  return `rgb(${Math.round(255 - (255 - r) * t)},${Math.round(255 - (255 - g) * t)},${Math.round(255 - (255 - b) * t)})`;
}

function SummaryBox({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-neutral-800" style={color ? { color } : undefined}>
        {value}
        {unit && <span className="ml-0.5 text-xs font-normal text-neutral-400">{unit}</span>}
      </div>
    </div>
  );
}

function StateChip({ active, onClick, label, count, color }: {
  active: boolean; onClick: () => void; label: string; count: number; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'text-white' : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
      }`}
      style={active ? { background: color ?? '#2b2b2b' } : undefined}
    >
      {!active && color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
      <span className={`text-[10px] ${active ? 'text-white/80' : 'text-neutral-400'}`}>{count}</span>
    </button>
  );
}

function timeOf(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}
