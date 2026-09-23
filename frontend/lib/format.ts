/**
 * Shared display formatters (JP locale).
 */

/** `YYYY/MM/DD HH:mm` (e.g. 2026/03/01 09:30). Nullish/invalid input -> '—'. */
export function fmtDateTime(iso?: string | null): string {
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

/** `M/D HH:mm` (e.g. 3/1 09:30). Nullish/invalid input -> '—'. */
export function fmtDateTimeShort(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

/** `M月D日 HH:mm` (e.g. 3月1日 09:30). Nullish/invalid input -> null. */
export function fmtMeasuredAt(iso?: string | null): string | null {
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

/** `M月D日 HH:mm`, falling back to '—'. */
export function fmtMeasuredAtOrDash(iso?: string | null): string {
  return fmtMeasuredAt(iso) ?? '—';
}

/** `YYYY/MM/DD HH:mm` via `toLocaleString('ja-JP')`. Nullish/invalid input -> '—'. */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `M/D HH:mm` via `toLocaleString('ja-JP')`. Nullish/invalid input -> '—'. */
export function fmtDateShort(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** date-style medium + time-style short via `toLocaleString('ja-JP')`. */
export function fmtDateTimeMedium(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Human-readable byte size (e.g. `1.5 MB`). Nullish/zero -> '—'. */
export function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}