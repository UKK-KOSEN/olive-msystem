'use client';

import { useEffect, useRef } from 'react';

export function Snackbar({
  message,
  kind = 'ok',
  onClose,
  position = 'inline',
  stack = 0,
}: {
  message: string;
  kind?: 'ok' | 'err';
  onClose: () => void;
  position?: 'inline' | 'fixed';
  stack?: number;
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (position !== 'fixed') {
      const t = setTimeout(() => onCloseRef.current(), 4000);
      return () => clearTimeout(t);
    }
  }, [position]);

  const cls =
    kind === 'ok'
      ? 'border-health-good/30 bg-health-good/10 text-health-good'
      : 'border-health-danger/30 bg-health-danger/10 text-health-danger';

  const base = 'flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm';

  if (position === 'fixed') {
    const bottom = 16 + stack * 80;
    return (
      <div
        className={`fixed right-4 rounded-lg px-4 py-3 text-sm ${cls}`}
        style={{ bottom: `${bottom}px`, zIndex: 100 + stack }}
        role={kind === 'err' ? 'alert' : 'status'}
        aria-live={kind === 'err' ? 'assertive' : 'polite'}
      >
        <div className="flex items-center justify-between gap-3">
          <span>{message}</span>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="shrink-0 text-sm font-medium opacity-70 hover:opacity-100"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${base} ${cls}`}
      role={kind === 'err' ? 'alert' : 'status'}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={() => onCloseRef.current()}
        className="shrink-0 text-sm font-medium opacity-70 hover:opacity-100"
        aria-label="閉じる"
      >
        ×
      </button>
    </div>
  );
}
