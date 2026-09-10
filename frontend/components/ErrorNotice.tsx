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
      className={`mt-3 flex items-start justify-between gap-3 rounded-lg bg-health-danger/10 px-3 py-2.5 text-sm text-health-danger ${className}`}
    >
      <p className="min-w-0 leading-relaxed">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-health-danger/30 bg-white px-2.5 py-1 text-xs font-medium text-health-danger transition-colors hover:bg-health-danger/10"
        >
          再試行
        </button>
      )}
    </div>
  );
}