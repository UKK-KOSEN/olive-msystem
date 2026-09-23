'use client';

type Status = 'pending' | 'processing' | 'done' | 'error';

const STATUS_MAP: Record<Status, { label: string; cls: string }> = {
  pending: { label: '待機中', cls: 'bg-neutral-100 text-neutral-600' },
  processing: { label: '解析中', cls: 'bg-olive-50 text-olive-700' },
  done: { label: '完了', cls: 'bg-health-good/10 text-health-good' },
  error: { label: 'エラー', cls: 'bg-health-danger/10 text-health-danger' },
};

export function StatusBadge({
  status,
  pendingLabel = '待機中',
}: {
  status: Status;
  pendingLabel?: string;
}) {
  const m = STATUS_MAP[status] || STATUS_MAP.pending;
  const label = status === 'pending' ? pendingLabel : m.label;
  return <span className={`badge ${m.cls}`}>{label}</span>;
}

export function statusLabel(status: Status): string {
  return STATUS_MAP[status]?.label ?? status;
}