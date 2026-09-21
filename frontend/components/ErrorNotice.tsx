'use client';

export default function ErrorNotice({
  message,
  onRetry,
  className = '',
}: {
  message: string | null | undefined;
  onRetry?: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`mt-3 flex items-start justify-between gap-3 rounded-lg border border-health-danger/20 bg-health-danger/10 px-3 py-2.5 text-sm text-health-danger ${className}`}
    >
      <p className="min-w-0 flex-1 leading-relaxed">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-health-danger/40 bg-health-danger px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-health-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-health-danger focus-visible:ring-offset-1"
          aria-label="再試行"
        >
          再試行
        </button>
      )}
    </div>
  );
}
