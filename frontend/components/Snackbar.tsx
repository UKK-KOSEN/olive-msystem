'use client';

import { useEffect } from 'react';

/**
 * Consistent, non-blocking feedback toast for save / delete / error messages.
 */
export function Snackbar({
  message,
  kind = 'ok',
  onClose,
}: {
  message: string;
  kind?: 'ok' | 'err';
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const cls =
    kind === 'ok'
      ? 'border-health-good/30 bg-health-good/10 text-health-good'
      : 'border-health-danger/30 bg-health-danger/10 text-health-danger';

  return (
    <div
      className={`mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${cls}`}
      role={kind === 'err' ? 'alert' : 'status'}
    >
      <span>{message}</span>
      <button onClick={onClose} className="shrink-0 text-sm font-medium opacity-70 hover:opacity-100" aria-label="閉じる">
        ×
      </button>
    </div>
  );
}
